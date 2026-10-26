'use strict';

// TokenRouter engine (#409). TokenRouter (api.tokenrouter.com, a new-api gateway)
// serves OpenAI chat completions for Kimi K3 and the other routed models. Wren
// runs the Claude Code CLI in the jail, so this loopback bridge takes the CLI's
// Anthropic Messages calls and relays them to TokenRouter /v1/chat/completions
// with the real key. The key never enters the jail: the CLI only holds the
// per-boot bridge secret, and the bridge listens on 127.0.0.1 only.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Every keyed TokenRouter request goes through the account's rate-limit queue (#418).
const gate = require('./tokenRouterGate');

const DEFAULT_BASE = 'https://api.tokenrouter.com';
// Default for new Director/Xi TokenRouter sessions (Yukimi 2026-10-20). Saved per-session picks win.
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
const CATALOG_TTL_MS = 10 * 60 * 1000;
// none turns thinking off (reasoning_effort: "none"; DeepSeek V4.1 Flash answers with 0 reasoning tokens).
const EFFORTS = ['none', 'low', 'medium', 'high'];
// A family's fast sibling is the same id with one of these suffixes.
const FAST_SUFFIXES = ['-fast', '-highspeed', '-ultraspeed'];
const VENDOR_NAMES = { '阿里巴巴': 'Alibaba', '智谱': 'Z.ai', '快手': 'Kuaishou', Minimax: 'MiniMax' };
const NAME_WORDS = { glm: 'GLM', gpt: 'GPT', oss: 'OSS', vl: 'VL', ai: 'AI', mimo: 'MiMo', minimax: 'MiniMax', deepseek: 'DeepSeek', qwen: 'Qwen' };
const MAX_BODY_BYTES = 96 * 1024 * 1024;
const PING_MS = 15000;
const UPSTREAM_IDLE_MS = 10 * 60 * 1000;
// Thinking blocks the bridge made carry this signature, so they can go back as reasoning_content.
const THINKING_SIGNATURE = 'dreamscape-tokenrouter';

let boundGr = null;
let catalogCache = { at: 0, families: null };
let catalogPromise = null;
let bridge = null;
// model id -> Set of request fields the model refused (see RELAXERS)
const learnedRelaxers = new Map();

function bindGlobalResources(gr) {
    if (!gr) return;
    boundGr = gr;
    // config.json tokenRouter.requestsPerMinute (default 8; the account allows 10, failures included).
    gate.configure({
        limit: () => {
            try {
                return Number(gr.getConfig({ path: 'tokenRouter.requestsPerMinute' })) || gate.DEFAULT_PER_MINUTE;
            } catch (_) {
                return gate.DEFAULT_PER_MINUTE;
            }
        }
    });
}

function baseUrl() {
    const raw = String(process.env.TOKENROUTER_BASE_URL || DEFAULT_BASE).trim();
    return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

// Security Center > API keys (service `tokenrouter`, secure.config.json tokenrouter.keys[]), then TOKENROUTER_API_KEY.
function apiKey(gr) {
    const resources = gr || boundGr;
    try {
        const key = resources && resources.getApiKeyManager().getActiveApiKey('tokenrouter');
        if (key) return String(key).trim();
    } catch (_) { /* key manager not ready */ }
    return process.env.TOKENROUTER_API_KEY ? String(process.env.TOKENROUTER_API_KEY).trim() : null;
}

function hasApiKey(gr) {
    return !!apiKey(gr);
}

// ---- Catalog ----

function prettyModelName(id) {
    const tail = String(id).split('/').pop();
    return tail.split(/[-_]/).filter(Boolean).map((word) => {
        const lower = word.toLowerCase();
        if (NAME_WORDS[lower]) return NAME_WORDS[lower];
        if (/^[a-z]\d/.test(lower)) return lower.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

function vendorName(row, vendors) {
    const vendor = vendors.get(row.vendor_id);
    if (!vendor) return 'Other';
    if (VENDOR_NAMES[vendor]) return VENDOR_NAMES[vendor];
    return /^[A-Za-z0-9 .&-]{1,40}$/.test(vendor) ? vendor : 'Other';
}

// Ids reach menu labels, so anything outside a plain model-id alphabet is dropped.
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;

function isChatRow(row) {
    if (!row || !SAFE_MODEL_ID.test(String(row.model_name || ''))) return false;
    const types = Array.isArray(row.supported_endpoint_types) ? row.supported_endpoint_types : [];
    if (!types.includes('openai')) return false;
    if (Number(row.quota_type) !== 0) return false;
    return /text/i.test(String(row.tags || 'text'));
}

// new-api /api/pricing: model_ratio 1 is $2 per million input tokens; output is that times completion_ratio.
function catalogFromPricing(body) {
    const rows = body && Array.isArray(body.data) ? body.data : [];
    const vendors = new Map((Array.isArray(body && body.vendors) ? body.vendors : []).map((v) => [v.id, v.name]));
    const groupRatio = Number(body && body.group_ratio && body.group_ratio.default) || 1;
    const chat = rows.filter(isChatRow);
    const ids = new Set(chat.map((row) => row.model_name));
    const fastOf = new Map();
    chat.forEach((row) => {
        const suffix = FAST_SUFFIXES.find((s) => row.model_name.endsWith(s));
        if (!suffix) return;
        const base = row.model_name.slice(0, -suffix.length);
        if (ids.has(base) && !fastOf.has(base)) fastOf.set(base, row.model_name);
    });
    const folded = new Set(fastOf.values());
    return chat.filter((row) => !folded.has(row.model_name)).map((row, index, list) => {
        const input = Math.round(Number(row.model_ratio) * 2 * groupRatio * 1000) / 1000;
        const output = Math.round(input * (Number(row.completion_ratio) || 1) * 1000) / 1000;
        return {
            id: row.model_name,
            name: prettyModelName(row.model_name),
            provider: vendorName(row, vendors),
            // The gateway lists newest first; keep that order inside each provider.
            released: list.length - index,
            input: Number.isFinite(input) ? input : null,
            output: Number.isFinite(output) ? output : null,
            fastId: fastOf.get(row.model_name) || null
        };
    });
}

function readCatalogFile(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && Array.isArray(parsed.families) && parsed.families.length) return parsed;
    } catch (_) { /* no cache yet */ }
    return null;
}

function writeCatalogFile(file, families) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ at: Date.now(), families }));
    } catch (_) { /* cache is optional */ }
}

async function fetchCatalog() {
    const res = await fetch(`${baseUrl()}/api/pricing`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`TokenRouter catalog answered ${res.status}`);
    const families = catalogFromPricing(await res.json());
    if (!families.length) throw new Error('TokenRouter catalog has no chat models');
    return families;
}

// Public /api/pricing needs no key. Falls back to the last saved list when the gateway is down.
async function listModels(options) {
    const opts = options || {};
    const now = Date.now();
    if (!catalogCache.families && opts.cacheFile) {
        const disk = readCatalogFile(opts.cacheFile);
        if (disk) catalogCache = { at: Number(disk.at) || 0, families: disk.families };
    }
    const fresh = catalogCache.families && now - catalogCache.at < CATALOG_TTL_MS;
    if (fresh && !opts.force) return catalogCache.families;
    if (!catalogPromise) {
        catalogPromise = fetchCatalog().then((families) => {
            catalogCache = { at: Date.now(), families };
            if (opts.cacheFile) writeCatalogFile(opts.cacheFile, families);
            return families;
        }).catch((error) => {
            if (catalogCache.families) return catalogCache.families;
            throw error;
        }).finally(() => {
            catalogPromise = null;
        });
    }
    if (catalogCache.families && !opts.force) return catalogCache.families;
    return catalogPromise;
}

function defaultFamily(families) {
    return families.find((item) => item.id === DEFAULT_MODEL) || families[0] || null;
}

// { family, model, effort, fast } for one turn. model is the id the CLI sends:
// the fast sibling when fast is on and the family has one.
function resolveRun(families, choice) {
    const list = Array.isArray(families) ? families : [];
    const requested = String((choice && choice.model) || '').trim();
    const family = list.find((item) => item.id === requested) || defaultFamily(list);
    const wanted = String((choice && choice.effort) || 'medium').trim().toLowerCase();
    const effort = EFFORTS.includes(wanted) ? wanted : 'medium';
    if (!family) {
        return { family: requested || DEFAULT_MODEL, model: requested || DEFAULT_MODEL, effort, fast: false };
    }
    const fast = !!(choice && choice.fast === true && family.fastId);
    return { family: family.id, model: fast ? family.fastId : family.id, effort, fast };
}

// ---- Anthropic Messages -> OpenAI chat completions ----

function systemText(system) {
    if (!system) return '';
    if (typeof system === 'string') return system;
    if (Array.isArray(system)) {
        return system.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('\n\n');
    }
    return '';
}

// OpenAI function names: ^[a-zA-Z0-9_-]{1,64}$. Claude Code and MCP names nearly always fit.
function safeToolName(name) {
    const raw = String(name || 'tool');
    let safe = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safe.length > 64) {
        const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 8);
        safe = `${safe.slice(0, 55)}_${hash}`;
    }
    return safe || 'tool';
}

function toolNames(tools) {
    const toUpstream = new Map();
    const fromUpstream = new Map();
    const schemas = new Map();
    (Array.isArray(tools) ? tools : []).forEach((tool) => {
        if (!tool || !tool.name) return;
        const safe = safeToolName(tool.name);
        toUpstream.set(tool.name, safe);
        fromUpstream.set(safe, tool.name);
        if (tool.input_schema && typeof tool.input_schema === 'object') schemas.set(tool.name, tool.input_schema);
    });
    return {
        up: (name) => toUpstream.get(name) || safeToolName(name),
        down: (name) => fromUpstream.get(name) || name,
        schema: (name) => schemas.get(name) || null
    };
}

function imagePart(block) {
    const source = block && block.source;
    if (!source) return null;
    if (source.type === 'base64' && source.data) {
        return { type: 'image_url', image_url: { url: `data:${source.media_type || 'image/png'};base64,${source.data}` } };
    }
    if (source.type === 'url' && source.url) return { type: 'image_url', image_url: { url: source.url } };
    return null;
}

function toolResultParts(content) {
    const texts = [];
    const images = [];
    if (typeof content === 'string') {
        texts.push(content);
    } else if (Array.isArray(content)) {
        content.forEach((block) => {
            if (!block) return;
            if (block.type === 'text') texts.push(block.text || '');
            else if (block.type === 'image') {
                const part = imagePart(block);
                if (part) images.push(part);
            }
        });
    } else if (content != null) {
        texts.push(JSON.stringify(content));
    }
    return { text: texts.join('\n'), images };
}

function userMessages(message, options) {
    if (typeof message.content === 'string') return [{ role: 'user', content: message.content }];
    const tools = [];
    const parts = [];
    const toolImages = [];
    (Array.isArray(message.content) ? message.content : []).forEach((block) => {
        if (!block) return;
        if (block.type === 'tool_result') {
            const result = toolResultParts(block.content);
            let text = result.text || (result.images.length ? '(image below)' : '(no output)');
            if (block.is_error) text = `Error: ${text}`;
            tools.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text });
            toolImages.push(...result.images);
        } else if (block.type === 'text') {
            if (block.text) parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'image') {
            const part = imagePart(block);
            if (part) parts.push(part);
        } else if (block.type === 'document') {
            parts.push({ type: 'text', text: '[A document was attached here; this model cannot read documents.]' });
        }
    });
    // Tool messages cannot carry images, so they follow as one user message.
    if (toolImages.length) {
        parts.push({ type: 'text', text: 'Images returned by the tool calls above:' });
        parts.push(...toolImages);
    }
    let images = parts.filter((part) => part.type === 'image_url');
    if (options.noImages && images.length) {
        parts.splice(0, parts.length, ...parts.map((part) => (part.type === 'image_url'
            ? { type: 'text', text: '[image omitted: this model cannot see images]' }
            : part)));
        images = [];
    }
    const out = tools.slice();
    if (parts.length) {
        const textOnly = !images.length;
        out.push({ role: 'user', content: textOnly ? parts.map((part) => part.text).join('\n\n') : parts });
    }
    return out;
}

function assistantMessage(message, names, options) {
    if (typeof message.content === 'string') return message.content ? { role: 'assistant', content: message.content } : null;
    const texts = [];
    const reasoning = [];
    const calls = [];
    (Array.isArray(message.content) ? message.content : []).forEach((block) => {
        if (!block) return;
        if (block.type === 'text') texts.push(block.text || '');
        else if (block.type === 'thinking' && block.signature === THINKING_SIGNATURE) reasoning.push(block.thinking || '');
        else if (block.type === 'tool_use') {
            calls.push({
                id: block.id,
                type: 'function',
                function: { name: names.up(block.name), arguments: JSON.stringify(unwrapToolInput(block.input || {})) }
            });
        }
    });
    const text = texts.join('');
    if (!text && !calls.length) return null;
    const out = { role: 'assistant', content: text || (calls.length ? null : '') };
    if (calls.length) out.tool_calls = calls;
    if (reasoning.length && !options.noReasoningContent) out.reasoning_content = reasoning.join('');
    return out;
}

function toolChoice(choice, names) {
    if (!choice || typeof choice !== 'object') return undefined;
    if (choice.type === 'auto') return 'auto';
    if (choice.type === 'any') return 'required';
    if (choice.type === 'none') return 'none';
    if (choice.type === 'tool' && choice.name) return { type: 'function', function: { name: names.up(choice.name) } };
    return undefined;
}

function toolDefinitions(tools, names) {
    return (Array.isArray(tools) ? tools : [])
        // Server tools (web search and friends) only exist on Anthropic's API.
        .filter((tool) => tool && tool.name && (tool.input_schema || !tool.type || tool.type === 'custom'))
        .map((tool) => {
            const parameters = tool.input_schema && typeof tool.input_schema === 'object'
                ? { ...tool.input_schema }
                : { type: 'object', properties: {} };
            delete parameters.$schema;
            return {
                type: 'function',
                function: { name: names.up(tool.name), description: tool.description || '', parameters }
            };
        });
}

// options: { model, effort, stream, noImages, noReasoningContent, noEffort, noMaxTokens }
function toOpenAIRequest(body, options) {
    const opts = options || {};
    const names = toolNames(body.tools);
    const messages = [];
    const system = systemText(body.system);
    if (system) messages.push({ role: 'system', content: system });
    (Array.isArray(body.messages) ? body.messages : []).forEach((message) => {
        if (!message) return;
        if (message.role === 'assistant') {
            const out = assistantMessage(message, names, opts);
            if (out) messages.push(out);
        } else {
            messages.push(...userMessages(message, opts));
        }
    });
    const request = {
        model: opts.model || body.model,
        messages,
        stream: opts.stream !== false
    };
    if (request.stream) request.stream_options = { include_usage: true };
    if (body.max_tokens && !opts.noMaxTokens) request.max_tokens = body.max_tokens;
    if (typeof body.temperature === 'number') request.temperature = body.temperature;
    if (typeof body.top_p === 'number') request.top_p = body.top_p;
    if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) request.stop = body.stop_sequences.slice(0, 4);
    const tools = toolDefinitions(body.tools, names);
    if (tools.length) {
        request.tools = tools;
        const choice = toolChoice(body.tool_choice, names);
        if (choice) request.tool_choice = choice;
        if (body.tool_choice && body.tool_choice.disable_parallel_tool_use) request.parallel_tool_calls = false;
    }
    if (opts.effort && !opts.noEffort) request.reasoning_effort = opts.effort;
    return { request, names };
}

// A model that refuses a field gets the request again without it (once per field).
const RELAXERS = [
    { key: 'noEffort', test: /reasoning[_ ]?effort/i },
    { key: 'noReasoningContent', test: /reasoning[_ ]?content/i },
    { key: 'noImages', test: /image|vision|multimodal|image_url/i },
    { key: 'noMaxTokens', test: /max[_ ]?(?:completion[_ ]?)?tokens/i }
];

const RELAXER_LABELS = { noEffort: 'reasoning_effort', noReasoningContent: 'reasoning_content', noImages: 'images', noMaxTokens: 'max_tokens' };

// ---- OpenAI chat completions -> Anthropic Messages ----

const STOP_REASONS = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'end_turn' };

function anthropicUsage(usage) {
    const u = usage || {};
    const prompt = Number(u.prompt_tokens) || 0;
    const cached = Number((u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || u.cached_tokens) || 0;
    return {
        input_tokens: Math.max(0, prompt - cached),
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: 0,
        output_tokens: Number(u.completion_tokens) || 0
    };
}

function asToolObject(parsed) {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return { value: parsed };
}

function tryParseJson(text) {
    try {
        return asToolObject(JSON.parse(text));
    } catch (_) {
        return null;
    }
}

// First `{...}` that balances, strings and escapes included. MiniMax (and some
// other TokenRouter vendors) stream fragments and then repeat the full object,
// so the concatenated buffer is `{...}{...}` and JSON.parse of the whole fails.
function firstCompleteJsonObject(text) {
    const s = String(text || '');
    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inString) {
            if (escape) escape = false;
            else if (ch === '\\') escape = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth += 1;
        } else if (ch === '}') {
            if (depth === 0) continue;
            depth -= 1;
            if (depth === 0 && start >= 0) return s.slice(start, i + 1);
        }
    }
    return null;
}

function completeJsonObjects(text) {
    const out = [];
    let rest = String(text || '');
    for (let i = 0; i < 32 && rest; i++) {
        const raw = firstCompleteJsonObject(rest);
        if (!raw) break;
        const parsed = tryParseJson(raw);
        if (parsed) out.push(parsed);
        const at = rest.indexOf(raw);
        rest = at >= 0 ? rest.slice(at + raw.length) : '';
    }
    return out;
}

// Prefer the full buffer when it is JSON. MiniMax then appends a second copy
// of the same object: use that final copy when it parses, otherwise the first
// complete object. Never put `_unparsed_arguments` in tool input — the CLI
// feeds that object back on the next turn and it nests.
function parseToolArguments(raw) {
    const text = String(raw || '').trim();
    if (!text) return {};
    const whole = tryParseJson(text);
    if (whole) return unwrapToolInput(whole);
    const objects = completeJsonObjects(text);
    if (objects.length) return unwrapToolInput(objects[objects.length - 1]);
    return {};
}

function unwrapToolInput(input) {
    let cur = input;
    for (let i = 0; i < 20; i++) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return {};
        if (typeof cur._unparsed_arguments !== 'string') return cur;
        const next = parseToolArguments(cur._unparsed_arguments);
        if (next === cur || (next && next._unparsed_arguments === cur._unparsed_arguments)) return {};
        cur = next;
    }
    return {};
}

// MiniMax (and other vendors with an XML-style native tool format) send every
// leaf as a string ("14", "true", "0.5"), arrays as {"item": [...]} and an
// empty array as "". Put the values back in the types the tool schema asks
// for. Only a value whose type does not match is touched; strings the schema
// allows are left alone.
function schemaTypes(schema) {
    if (!schema || typeof schema !== 'object') return [];
    if (Array.isArray(schema.type)) return schema.type;
    if (typeof schema.type === 'string') return [schema.type];
    if (schema.properties) return ['object'];
    if (schema.items) return ['array'];
    return [];
}

function schemaVariants(schema) {
    const alts = (schema && (schema.anyOf || schema.oneOf)) || null;
    return Array.isArray(alts) && alts.length ? alts : [schema];
}

function matchesType(value, type) {
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'null') return value === null;
    return typeof value === type;
}

function coerceLeaf(value, type) {
    if (type === 'array') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value);
            if (keys.length === 1 && keys[0] === 'item') return Array.isArray(value.item) ? value.item : [value.item];
        }
        if (typeof value === 'string') {
            const t = value.trim();
            if (!t) return [];
            if (t.startsWith('[')) { try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch (_) { /* keep */ } }
        }
        return undefined;
    }
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    if (type === 'object' && t.startsWith('{')) {
        try { const v = JSON.parse(t); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (_) { /* keep */ }
        return undefined;
    }
    if ((type === 'number' || type === 'integer') && /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) {
        const n = Number(t);
        if (type === 'integer' && !Number.isInteger(n)) return undefined;
        return n;
    }
    if (type === 'boolean' && (t === 'true' || t === 'false')) return t === 'true';
    if (type === 'null' && t === 'null') return null;
    return undefined;
}

// Values with no schema of their own (inside an untyped object such as
// apply_studio_changes change, or an array with no items schema) still arrive
// from MiniMax as {"item": {...}} wrappers and "0" / "true" strings. Unwrap the
// wrapper and type the plain scalars there too. Text-like keys keep strings.
const LOOSE_TEXT_KEYS = new Set(['prompt', 'uc', 'promptNegative', 'prompt_negative', 'name', 'presetName',
    'text', 'content', 'label', 'title', 'description', 'filename', 'customText', 'caption', 'id', 'key',
    'source', 'value', 'workspace', 'model', 'sampler', 'noiseScheduler', 'resolution', 'effort', 'dreamscape']);

function looseCoerce(value, key, depth) {
    const d = depth || 0;
    if (d > 24) return value;
    if (Array.isArray(value)) return value.map((item) => looseCoerce(item, null, d + 1));
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === 'item') {
            const inner = Array.isArray(value.item) ? value.item : [value.item];
            return inner.map((item) => looseCoerce(item, null, d + 1));
        }
        const next = {};
        keys.forEach((k) => { next[k] = looseCoerce(value[k], k, d + 1); });
        return next;
    }
    if (typeof value !== 'string' || (key && LOOSE_TEXT_KEYS.has(key))) return value;
    const t = value.trim();
    if (t === 'true' || t === 'false') return t === 'true';
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(t) && t.length <= 17) return Number(t);
    return value;
}

function coerceToSchema(value, schema, depth) {
    const d = depth || 0;
    if (!schema || typeof schema !== 'object' || d > 24) return value;
    const variants = schemaVariants(schema);
    let target = null;
    let out = value;
    for (const variant of variants) {
        const types = schemaTypes(variant);
        if (!types.length || types.some((type) => matchesType(value, type))) { target = variant; break; }
    }
    if (!target) {
        for (const variant of variants) {
            for (const type of schemaTypes(variant)) {
                const fixed = coerceLeaf(value, type);
                if (fixed !== undefined) { out = fixed; target = variant; break; }
            }
            if (target) break;
        }
    }
    if (!target) return value;
    if (Array.isArray(out)) {
        const itemSchema = target.items && !Array.isArray(target.items) ? target.items : null;
        return itemSchema ? out.map((item) => coerceToSchema(item, itemSchema, d + 1)) : out.map((item) => looseCoerce(item, null, d + 1));
    }
    if (out && typeof out === 'object') {
        const props = target.properties && typeof target.properties === 'object' ? target.properties : {};
        const extra = target.additionalProperties && typeof target.additionalProperties === 'object' ? target.additionalProperties : null;
        const next = {};
        Object.keys(out).forEach((key) => {
            const sub = props[key] || extra;
            // additionalProperties: true means the tool takes any value there as sent.
            if (sub) next[key] = coerceToSchema(out[key], sub, d + 1);
            else next[key] = target.additionalProperties === true ? out[key] : looseCoerce(out[key], key, d + 1);
        });
        return next;
    }
    return out;
}

function toolInputFor(names, upstreamName, input) {
    const schema = names && typeof names.schema === 'function' ? names.schema(names.down(upstreamName)) : null;
    if (!schema) return input;
    const out = coerceToSchema(input, schema);
    // change mirrors the top-level apply_studio_changes fields: type it with them.
    const props = schema.properties || {};
    if (props.change && out && out.change && typeof out.change === 'object' && !Array.isArray(out.change)) {
        const mirror = Object.assign({}, props);
        delete mirror.change;
        out.change = coerceToSchema(out.change, { type: 'object', properties: mirror }, 1);
    }
    return out;
}

const REPEAT_MIN = 24;

// Whole reasoning that is one text twice over ("AB" + "AB") comes back once.
function undoubledReasoning(text) {
    const s = String(text || '');
    if (s.length >= REPEAT_MIN * 2 && s.length % 2 === 0) {
        const half = s.length / 2;
        if (s.slice(0, half) === s.slice(half)) return s.slice(0, half);
    }
    return s;
}

function newMessageId() {
    return `msg_${crypto.randomBytes(12).toString('hex')}`;
}

function newToolId() {
    return `toolu_${crypto.randomBytes(12).toString('hex')}`;
}

// Text and thinking stream through as they arrive. Tool calls are buffered and
// sent whole at the end: some gateways interleave argument chunks, and the CLI
// only reports whole messages to the Director anyway.
class StreamTranslator {
    constructor(model, names) {
        this.model = model;
        this.names = names;
        this.index = 0;
        this.open = null;
        this.calls = new Map();
        this.finishReason = null;
        this.usage = null;
        this.reasoningSeen = '';
    }

    start() {
        return [['message_start', {
            type: 'message_start',
            message: {
                id: newMessageId(),
                type: 'message',
                role: 'assistant',
                model: this.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 }
            }
        }]];
    }

    closeOpen(events) {
        if (!this.open) return;
        if (this.open === 'thinking') {
            events.push(['content_block_delta', {
                type: 'content_block_delta',
                index: this.index,
                delta: { type: 'signature_delta', signature: THINKING_SIGNATURE }
            }]);
        }
        events.push(['content_block_stop', { type: 'content_block_stop', index: this.index }]);
        this.index += 1;
        this.open = null;
    }

    ensureOpen(type, events) {
        if (this.open === type) return;
        this.closeOpen(events);
        const block = type === 'thinking' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' };
        events.push(['content_block_start', { type: 'content_block_start', index: this.index, content_block: block }]);
        this.open = type;
    }

    // MiniMax streams its reasoning, then sends the whole reasoning again in
    // one chunk. A chunk that repeats what this thinking block already holds
    // replaces it: only the part past the received text goes out.
    freshReasoning(chunk) {
        if (this.open !== 'thinking') this.reasoningSeen = '';
        const seen = this.reasoningSeen;
        let fresh = chunk;
        if (seen.length >= REPEAT_MIN && chunk.length >= REPEAT_MIN) {
            if (chunk.startsWith(seen)) fresh = chunk.slice(seen.length);
            else if (seen.startsWith(chunk) || seen.endsWith(chunk)) fresh = '';
        }
        this.reasoningSeen = seen + fresh;
        return fresh;
    }

    chunk(json) {
        const events = [];
        if (json && json.usage) this.usage = json.usage;
        const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
        if (!choice) return events;
        const delta = choice.delta || choice.message || {};
        const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
            : (typeof delta.reasoning === 'string' ? delta.reasoning : '');
        const fresh = reasoning ? this.freshReasoning(reasoning) : '';
        if (fresh) {
            this.ensureOpen('thinking', events);
            events.push(['content_block_delta', {
                type: 'content_block_delta',
                index: this.index,
                delta: { type: 'thinking_delta', thinking: fresh }
            }]);
        }
        if (typeof delta.content === 'string' && delta.content) {
            this.ensureOpen('text', events);
            events.push(['content_block_delta', {
                type: 'content_block_delta',
                index: this.index,
                delta: { type: 'text_delta', text: delta.content }
            }]);
        }
        (Array.isArray(delta.tool_calls) ? delta.tool_calls : []).forEach((call, position) => {
            if (!call) return;
            const key = Number.isInteger(call.index) ? call.index : (call.id || position);
            let slot = this.calls.get(key);
            if (!slot) {
                slot = { id: call.id || null, name: '', args: '' };
                this.calls.set(key, slot);
            }
            if (call.id && !slot.id) slot.id = call.id;
            const fn = call.function || {};
            if (fn.name) slot.name = slot.name && slot.name !== fn.name ? slot.name + fn.name : fn.name;
            if (typeof fn.arguments === 'string' && fn.arguments) {
                // MiniMax streams pieces, then a final full JSON object. Replace
                // when that last chunk parses; otherwise keep concatenating.
                // Only a whole object arriving after an already-complete buffer
                // is a repeat; a scalar fragment (`1`, `"abc"`) also parses and
                // must keep concatenating.
                const chunk = fn.arguments.trim();
                const repeat = chunk.startsWith('{') && slot.args.trim()
                    && tryParseJson(slot.args.trim()) && tryParseJson(chunk);
                if (repeat) slot.args = fn.arguments;
                else slot.args += fn.arguments;
            } else if (fn.arguments && typeof fn.arguments === 'object') {
                slot.args = JSON.stringify(fn.arguments);
            }
        });
        if (choice.finish_reason) this.finishReason = choice.finish_reason;
        return events;
    }

    finish() {
        const events = [];
        this.closeOpen(events);
        this.calls.forEach((slot) => {
            if (!slot.name) return;
            const input = toolInputFor(this.names, slot.name, parseToolArguments(slot.args));
            events.push(['content_block_start', {
                type: 'content_block_start',
                index: this.index,
                content_block: { type: 'tool_use', id: slot.id || newToolId(), name: this.names.down(slot.name), input: {} }
            }]);
            events.push(['content_block_delta', {
                type: 'content_block_delta',
                index: this.index,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) }
            }]);
            events.push(['content_block_stop', { type: 'content_block_stop', index: this.index }]);
            this.index += 1;
        });
        const hasTools = Array.from(this.calls.values()).some((slot) => slot.name);
        const stop = hasTools ? 'tool_use' : (STOP_REASONS[this.finishReason] || 'end_turn');
        events.push(['message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stop, stop_sequence: null },
            usage: anthropicUsage(this.usage)
        }]);
        events.push(['message_stop', { type: 'message_stop' }]);
        return events;
    }
}

// Non-streaming answer as one Anthropic message.
function toAnthropicMessage(json, model, names) {
    const translator = new StreamTranslator(model, names);
    const content = [];
    const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
    const message = (choice && choice.message) || {};
    const reasoning = message.reasoning_content || message.reasoning;
    if (typeof reasoning === 'string' && reasoning) content.push({ type: 'thinking', thinking: undoubledReasoning(reasoning), signature: THINKING_SIGNATURE });
    if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
    (Array.isArray(message.tool_calls) ? message.tool_calls : []).forEach((call) => {
        const fn = call && call.function;
        if (!fn || !fn.name) return;
        content.push({
            type: 'tool_use',
            id: call.id || newToolId(),
            name: translator.names.down(fn.name),
            input: toolInputFor(translator.names, fn.name, unwrapToolInput(
                typeof fn.arguments === 'object' && fn.arguments ? fn.arguments : parseToolArguments(fn.arguments)
            ))
        });
    });
    const hasTools = content.some((block) => block.type === 'tool_use');
    return {
        id: newMessageId(),
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: hasTools ? 'tool_use' : (STOP_REASONS[choice && choice.finish_reason] || 'end_turn'),
        stop_sequence: null,
        usage: anthropicUsage(json && json.usage)
    };
}

// ---- Bridge server ----

const ERROR_TYPES = {
    400: 'invalid_request_error',
    401: 'authentication_error',
    402: 'permission_error',
    403: 'permission_error',
    404: 'not_found_error',
    413: 'request_too_large',
    429: 'rate_limit_error',
    529: 'overloaded_error'
};

function sendJson(res, status, body) {
    if (res.headersSent) return;
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
}

function sendError(res, status, message) {
    sendJson(res, status, {
        type: 'error',
        error: { type: ERROR_TYPES[status] || 'api_error', message: String(message || 'TokenRouter failed').slice(0, 2000) }
    });
}

function upstreamMessage(text, status, label) {
    let message = '';
    try {
        const parsed = JSON.parse(text);
        const err = parsed && (parsed.error || parsed);
        message = (err && (err.message || err.msg || err.detail)) || (parsed && parsed.detail) || '';
    } catch (_) {
        message = String(text || '').trim();
    }
    const who = label || 'TokenRouter';
    const said = String(message || '').slice(0, 1500);
    if (status === 402) {
        return `${who} 402: insufficient balance. Top up the ${who} account, then send again.${said ? ` (${said})` : ''}`;
    }
    if (status === 429) {
        return `${who} 429: rate limit reached and still limited after waiting. Wait a minute, then send again.${said ? ` (${said})` : ''}`;
    }
    return `${who} ${status}: ${said || 'request failed'}`;
}

// 429 backoff for hosts outside the TokenRouter gate: Retry-After when the host sends one,
// else 2 s, 4 s, 8 s; never more than RATE_LIMIT_MAX_WAIT_MS per wait.
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_MS = 2000;
const RATE_LIMIT_MAX_WAIT_MS = 30000;

function rateLimitWaitMs(attempt, retryAfterMs) {
    const asked = Number(retryAfterMs);
    const wait = Number.isFinite(asked) && asked > 0 ? asked : RATE_LIMIT_BASE_MS * (2 ** attempt);
    return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(250, Math.round(wait)));
}

function retryAfterMs(res) {
    const header = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
    if (!header) return 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const at = Date.parse(header);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            return;
        }
        const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
}

// send() makes one request. A 429 is drained and sent again after the backoff.
async function withRateLimitBackoff(send, options) {
    const o = options || {};
    const wait = o.sleep || sleep;
    for (let attempt = 0; ; attempt++) {
        const res = await send();
        if (!res || res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return res;
        const ms = rateLimitWaitMs(attempt, retryAfterMs(res));
        try { await res.text(); } catch (_) { /* body already gone */ }
        console.warn(`${o.label || 'Custom provider'}: 429, trying again in ${Math.round(ms / 100) / 10}s`);
        await wait(ms, o.signal);
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (buf) => {
            size += buf.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Request too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(buf);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (_) {
                reject(Object.assign(new Error('Body is not JSON'), { status: 400 }));
            }
        });
        req.on('error', reject);
    });
}

function authorized(req, secret) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const given = String(req.headers['x-api-key'] || '').trim() || bearer;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function estimateTokens(body) {
    const text = JSON.stringify([body.system || '', body.messages || [], body.tools || []]);
    return Math.ceil(text.length / 4);
}

// Sends the request, dropping refused fields one at a time. Resolves with the
// upstream Response (ok) or { status, text } for the error to report.
// TokenRouter, or a custom provider from the x-dreamscape-provider header
// (modules/customModelProviders.js). Custom calls skip the TokenRouter rate gate.
function resolveUpstream(run) {
    const id = String((run && run.providerId) || '').trim().toLowerCase();
    if (id) {
        const custom = require('./customModelProviders');
        const provider = custom.lookup(boundGr, id);
        if (!provider) {
            return { error: { status: 401, text: JSON.stringify({ error: { message: `Unknown custom model provider "${id}".` } }) } };
        }
        if (!provider.apiKey) {
            return { error: { status: 401, text: JSON.stringify({ error: { message: `${provider.name} has no API key.` } }) } };
        }
        return {
            id: provider.engine,
            providerId: provider.id,
            baseUrl: provider.baseUrl,
            chatUrl: provider.chatUrl,
            key: provider.apiKey,
            label: provider.name,
            gated: provider.kind === 'tokenrouter'
        };
    }
    const key = apiKey();
    if (!key) {
        return { error: { status: 401, text: JSON.stringify({ error: { message: 'No TokenRouter API key. Add one in Security Center > API keys (TokenRouter).' } }) } };
    }
    return { id: 'tokenrouter', baseUrl: baseUrl(), key, label: 'TokenRouter', gated: true };
}

async function callUpstream(body, run, signal, stream) {
    const upstream = resolveUpstream(run);
    if (upstream.error) return upstream.error;
    const model = run.model || body.model;
    const learnKey = upstream.id === 'tokenrouter' ? model : `${upstream.id}\0${model}`;
    const learned = learnedRelaxers.get(learnKey) || new Set();
    const flags = {};
    learned.forEach((name) => { flags[name] = true; });
    for (let attempt = 0; attempt <= RELAXERS.length; attempt++) {
        const { request } = toOpenAIRequest(body, { ...flags, model, effort: run.effort, stream });
        const send = () => fetch(upstream.chatUrl || `${upstream.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${upstream.key}` },
            body: JSON.stringify(request),
            signal
        });
        const res = upstream.gated
            ? await gate.run(send, { lane: run.lane, signal, label: `${run.lane || 'interactive'} ${model}` })
            : await withRateLimitBackoff(send, { signal, label: `${upstream.label} ${model}` });
        // NVIDIA NIM's balance line reads these (customModelProviders.balanceInfo).
        if (upstream.providerId) require('./customModelProviders').noteRateLimit(upstream.providerId, res.headers);
        if (res.ok) return res;
        const text = await res.text().catch(() => '');
        if (res.status !== 400 && res.status !== 422) return { status: res.status, text, label: upstream.label };
        const relaxer = RELAXERS.find((item) => !flags[item.key] && item.test.test(text) && relaxerApplies(item.key, request));
        if (!relaxer) return { status: res.status, text, label: upstream.label };
        flags[relaxer.key] = true;
        learned.add(relaxer.key);
        learnedRelaxers.set(learnKey, learned);
        console.warn(`${upstream.label} ${model}: retrying without ${RELAXER_LABELS[relaxer.key]} (${res.status})`);
    }
    return { status: 400, text: JSON.stringify({ error: { message: `${upstream.label} refused every request shape` } }) };
}

function relaxerApplies(key, request) {
    if (key === 'noEffort') return 'reasoning_effort' in request;
    if (key === 'noMaxTokens') return 'max_tokens' in request;
    if (key === 'noReasoningContent') return request.messages.some((m) => m.reasoning_content);
    if (key === 'noImages') return request.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
    return false;
}

function writeEvent(res, name, data) {
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function relayStream(upstream, res, translator, abort) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    translator.start().forEach(([name, data]) => writeEvent(res, name, data));
    let idle = null;
    const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => abort.abort(new Error('TokenRouter went quiet')), UPSTREAM_IDLE_MS);
    };
    const ping = setInterval(() => writeEvent(res, 'ping', { type: 'ping' }), PING_MS);
    touch();
    let buffer = '';
    let failed = null;
    const decoder = new TextDecoder();
    const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let json;
        try { json = JSON.parse(payload); } catch (_) { return; }
        if (json && json.error) {
            failed = upstreamMessage(JSON.stringify(json), 'stream error');
            return;
        }
        translator.chunk(json).forEach(([name, data]) => writeEvent(res, name, data));
    };
    try {
        for await (const part of upstream.body) {
            touch();
            buffer += decoder.decode(part, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(handleLine);
            if (failed) break;
        }
        if (buffer && !failed) handleLine(buffer);
    } catch (error) {
        failed = `TokenRouter stream broke: ${error.message || error}`;
    } finally {
        clearTimeout(idle);
        clearInterval(ping);
    }
    if (failed) {
        writeEvent(res, 'error', { type: 'error', error: { type: 'api_error', message: failed } });
    } else {
        translator.finish().forEach(([name, data]) => writeEvent(res, name, data));
    }
    res.end();
}

async function handleMessages(req, res) {
    const body = await readBody(req);
    const effort = String(req.headers['x-dreamscape-effort'] || '').trim().toLowerCase();
    // x-dreamscape-lane: interactive (Director), normal (Rentan); see modules/tokenRouterGate.js.
    const lane = String(req.headers['x-dreamscape-lane'] || '').trim().toLowerCase();
    // x-dreamscape-provider: custom OpenAI host (modules/customModelProviders.js). Absent means TokenRouter.
    const providerId = String(req.headers['x-dreamscape-provider'] || '').trim().toLowerCase();
    const run = {
        model: body.model,
        effort: EFFORTS.includes(effort) ? effort : null,
        lane: gate.LANES.includes(lane) ? lane : 'interactive',
        providerId: /^[a-z][a-z0-9_-]{0,31}$/.test(providerId) ? providerId : ''
    };
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const stream = body.stream === true;
    const upstream = await callUpstream(body, run, abort.signal, stream);
    if (!upstream.ok) {
        sendError(res, upstream.status === 402 ? 403 : upstream.status, upstreamMessage(upstream.text, upstream.status, upstream.label));
        return;
    }
    const names = toolNames(body.tools);
    if (stream) {
        await relayStream(upstream, res, new StreamTranslator(body.model, names), abort);
        return;
    }
    sendJson(res, 200, toAnthropicMessage(await upstream.json(), body.model, names));
}

async function handle(req, res, secret) {
    const url = String(req.url || '').split('?')[0].replace(/\/+$/, '');
    if (!authorized(req, secret)) {
        sendError(res, 401, 'Not a Dreamscape bridge token');
        return;
    }
    try {
        if (req.method === 'POST' && url === '/v1/messages') {
            await handleMessages(req, res);
        } else if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
            sendJson(res, 200, { input_tokens: estimateTokens(await readBody(req)) });
        } else if (req.method === 'GET' && url === '/v1/models') {
            const families = (catalogCache.families || []);
            sendJson(res, 200, { data: families.map((item) => ({ type: 'model', id: item.id, display_name: item.name })), has_more: false });
        } else {
            sendError(res, 404, `No route ${req.method} ${url}`);
        }
    } catch (error) {
        if (error && error.name === 'AbortError') {
            if (!res.writableEnded) res.end();
            return;
        }
        if (res.headersSent) {
            try {
                writeEvent(res, 'error', { type: 'error', error: { type: 'api_error', message: `TokenRouter bridge: ${error.message}` } });
                res.end();
            } catch (_) { /* socket gone */ }
            return;
        }
        sendError(res, error.status || 502, `TokenRouter bridge: ${error.message || error}`);
    }
}

// Starts once per process on a random loopback port. The jail shares the host
// network (--share-net), so the CLI reaches it at 127.0.0.1.
function ensureBridge() {
    if (bridge) return bridge.ready;
    const secret = crypto.randomBytes(24).toString('hex');
    const server = http.createServer((req, res) => {
        handle(req, res, secret).catch((error) => sendError(res, 500, error.message));
    });
    server.keepAliveTimeout = 65000;
    server.requestTimeout = 0;
    const ready = new Promise((resolve, reject) => {
        server.once('error', (error) => {
            bridge = null;
            reject(error);
        });
        server.listen(0, '127.0.0.1', () => {
            server.unref();
            resolve({ port: server.address().port, secret, url: `http://127.0.0.1:${server.address().port}` });
        });
    });
    bridge = { server, ready };
    return ready;
}

function closeBridge() {
    if (!bridge) return;
    try { bridge.server.close(); } catch (_) { /* already closed */ }
    bridge = null;
}

// ---- Direct chat completions (Rentan resolver #422, persona chat #413) ----
// One OpenAI-format call through the #418 gate. json: ask for a JSON object.
// A model that refuses response_format or reasoning_effort gets the call again
// without it. Resolves { text, reasoning, usage, finish, model, ms }.
async function chatCompletion(request, options) {
    const opts = options || {};
    const key = apiKey(opts.gr);
    if (!key) {
        const error = new Error('No TokenRouter API key. Add one in Security Center > Service Keys (TokenRouter).');
        error.code = 'TOKENROUTER_KEY_MISSING';
        throw error;
    }
    const body = { ...request, stream: false };
    if (opts.json) body.response_format = { type: 'json_object' };
    if (opts.effort && EFFORTS.includes(opts.effort)) body.reasoning_effort = opts.effort;
    const started = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await gate.run(() => fetch(`${baseUrl()}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify(body),
            signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || 180000)
        }), { lane: opts.lane || 'interactive', signal: opts.signal, label: opts.label || body.model });
        const text = await res.text();
        if (res.ok) {
            const json = JSON.parse(text);
            const choice = (json.choices && json.choices[0]) || {};
            const message = choice.message || {};
            return {
                text: typeof message.content === 'string' ? message.content : '',
                reasoning: message.reasoning_content || message.reasoning || '',
                usage: json.usage || null,
                finish: choice.finish_reason || null,
                model: body.model,
                ms: Date.now() - started
            };
        }
        if (res.status === 400 && body.response_format && /response_format|json/i.test(text)) {
            delete body.response_format;
            continue;
        }
        if (res.status === 400 && body.reasoning_effort && /reasoning/i.test(text)) {
            delete body.reasoning_effort;
            continue;
        }
        const error = new Error(upstreamMessage(text, res.status));
        error.status = res.status;
        throw error;
    }
    throw new Error('TokenRouter refused every request shape');
}

// Account balance for the Director usage badge, from TokenRouter's management API:
// GET /api/management/self/wallet with a personal Management Key (it cannot make
// model requests; 10 calls a minute per key, cached a minute on their side).
// remaining is the one number shown: top-up balance plus unexpired vouchers.
const WALLET_TTL_MS = 60000;
let walletCache = { at: 0, key: '', value: null };

// The management key paired with the selected TokenRouter API key (same account).
function managementKey(gr) {
    const resources = gr || boundGr;
    try {
        const key = resources && resources.getApiKeyManager().getActiveSecondaryKey('tokenrouter');
        if (key) return String(key).trim();
    } catch (_) { /* key manager not ready */ }
    return process.env.TOKENROUTER_MANAGEMENT_KEY ? String(process.env.TOKENROUTER_MANAGEMENT_KEY).trim() : null;
}

function walletAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

// { configured: false } | { configured, error } | { configured, topUp, vouchers, remaining, spent }.
// Failures are cached too, so a bad key cannot spend the endpoint's rate limit.
async function walletAt(base, key) {
    const root = String(base || '').replace(/\/+$/, '');
    const fingerprint = crypto.createHash('sha256').update(`${root}\n${key}`).digest('hex').slice(0, 16);
    if (walletCache.value && walletCache.key === fingerprint && Date.now() - walletCache.at < WALLET_TTL_MS) {
        return walletCache.value;
    }
    let value;
    try {
        const res = await gate.run(() => fetch(`${root}/api/management/self/wallet`, {
            headers: { authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(10000)
        }), { lane: 'background', label: 'balance' });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || body.success === false || !body.data) {
            value = { configured: true, error: String((body && body.message) || `wallet answered ${res.status}`).slice(0, 200) };
        } else {
            const topUp = walletAmount(body.data.topUpBalance);
            const vouchers = walletAmount(body.data.voucherEfficientAmount);
            value = {
                configured: true,
                topUp,
                vouchers,
                remaining: Math.round((topUp + vouchers) * 100) / 100,
                spent: Math.round((walletAmount(body.data.toppedUpSpent) + walletAmount(body.data.voucherSpent)) * 100) / 100
            };
        }
    } catch (error) {
        value = { configured: true, error: `wallet unreachable (${error.message})` };
    }
    walletCache = { at: Date.now(), key: fingerprint, value };
    return value;
}

async function wallet(gr) {
    const key = managementKey(gr);
    if (!key) return { configured: false };
    return walletAt(baseUrl(), key);
}

module.exports = {
    DEFAULT_MODEL,
    EFFORTS,
    THINKING_SIGNATURE,
    bindGlobalResources,
    hasApiKey,
    baseUrl,
    catalogFromPricing,
    listModels,
    resolveRun,
    walletAt,
    ensureBridge,
    closeBridge,
    wallet,
    chatCompletion,
    _test: {
        catalogFromPricing,
        prettyModelName,
        toOpenAIRequest,
        StreamTranslator,
        toAnthropicMessage,
        parseToolArguments,
        unwrapToolInput,
        coerceToSchema,
        looseCoerce,
        toolInputFor,
        undoubledReasoning,
        toolNames,
        safeToolName,
        upstreamMessage,
        rateLimitWaitMs,
        withRateLimitBackoff,
        callUpstream,
        resetCatalog: () => { catalogCache = { at: 0, families: null }; learnedRelaxers.clear(); },
        resetWallet: () => { walletCache = { at: 0, key: '', value: null }; }
    }
};
