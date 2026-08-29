/**
 * Studio change JSON — paste / apply / export a compact studio delta.
 * public/scripts/comp/confirmationDialog.js
 * public/scripts/comp/desktopShortcuts.js
 * public/scripts/comp/manualModalManager.js
 * public/scripts/comp/manualDropdownManager.js
 * public/scripts/comp/characterPromptManager.js
 * public/scripts/comp/textareaUtils.js
 * public/scripts/comp/promptTextareaToolbar.js
 * public/scripts/comp/requestBodyReplacementsModal.js
 * docs/studio-change-json.md — bot-facing contract (Hoshino/other agents emit this blob).
 * STUDIO_CHANGE_AI_SPEC — compact copy for in-app Copy AI spec / agentic use.
 * When rules change, update the MD first, then this constant.
 */

const STUDIO_CHANGE_KIND = 'change';
const STUDIO_CHANGE_VERSION = 1;
const STUDIO_CHANGE_DIALOG_CLASS = 'studio-change-dialog-modal';

const STUDIO_CHANGE_AI_SPEC = `Dreamscape studio change JSON. Paste into Studio to apply. Reply with JSON only — no markdown unless fenced as json.

{"dreamscape":"change","v":1,"title":"short name",
 "params":{"steps":28,"guidance":5,"sampler":"k_euler_ancestral","noiseScheduler":"karras","model":"v5","resolution":"normal_portrait","append_uc":3},
 "expanders":[{"prefix":"alice_base","value":"long shared appearance, hair, body"}],
 "fields":[
   {"id":"prompt","action":"replace","chunks":[
     {"name":"Subject","text":"1girl, looking at viewer"},
     {"name":"Lighting","text":"sunset, golden hour"}
   ]},
   {"id":"uc","action":"replace","chunks":[{"name":"Quality","text":"blurry, lowres"}]}
 ],
 "characters":[
   {"index":0,"action":"replace","name":"Alice","prompt":"!alice_base, school uniform, smile","uc":"nude"},
   {"index":1,"action":"replace","name":"Bob","prompt":"bob prompt","uc":"alice (name)"}
 ],
 "vibes":[{"id":"vibe-id","ie":"v4full","strength":0.7,"inject_text":true}]}

Rules:
- characters: ALWAYS replace + index. NEVER add. index 0 = first slot, index 1 = second. add+index is illegal (treated as replace). Do not copy slot 0 into slot 1.
- fields = prompt | uc | promptNegative only. Always replace. Named chunks are your groups, not comma-splits. Never character:N:... ids.
- expanders: if present, DELETE all request expanders and install only this list. In text use !prefix. Do not repeat expander values.
- vibes: if present, REPLACE current vibe transfers with this id list (ids Studio already has). Omit to leave vibes unchanged. No image uploads.
- Default action is replace. remove = delete a span or slot. Omit unused keys. Only include params you want to change.
- Named resolution preset (e.g. normal_portrait): omit width/height. Custom size: resolution "custom" plus width and height.`;

const STUDIO_CHANGE_PARAM_DEFS = [
    { id: 'steps', label: 'Steps' },
    { id: 'guidance', label: 'Guidance' },
    { id: 'rescale', label: 'Rescale' },
    { id: 'sampler', label: 'Sampler' },
    { id: 'noiseScheduler', label: 'Noise scheduler' },
    { id: 'model', label: 'Model' },
    { id: 'seed', label: 'Seed' },
    { id: 'resolution', label: 'Resolution' },
    { id: 'width', label: 'Width' },
    { id: 'height', label: 'Height' },
    { id: 'variety', label: 'Variety' },
    { id: 'upscale', label: 'Upscale' },
    { id: 'strength', label: 'Strength' },
    { id: 'noise', label: 'Noise' },
    { id: 'append_quality', label: 'Quality preset' },
    { id: 'append_uc', label: 'UC preset' }
];

const STUDIO_CHANGE_FIELD_DEFS = [
    { id: 'prompt', label: 'Prompt' },
    { id: 'uc', label: 'UC' },
    { id: 'promptNegative', label: 'Prompt negative' }
];

const STUDIO_CHANGE_UC_PRESET_NAMES = {
    0: 'None',
    1: 'Human Focus',
    2: 'Light',
    3: 'Heavy',
    4: 'Curated',
    5: 'Furry Focus'
};

let studioChangeDialogBusy = false;

function isStudioChangePayload(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const kind = obj.dreamscape || obj.type || obj.kind;
    return kind === STUDIO_CHANGE_KIND || kind === 'dreamscape-change' || kind === 'studio-change';
}

function tryParseJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function extractBalancedObject(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

function extractStudioChangeJson(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const direct = tryParseJsonObject(raw);
    if (isStudioChangePayload(direct)) return direct;

    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        const fenced = tryParseJsonObject(fenceMatch[1].trim());
        if (isStudioChangePayload(fenced)) return fenced;
    }

    const marker = raw.search(/"dreamscape"\s*:\s*"change"|"type"\s*:\s*"dreamscape-change"|"kind"\s*:\s*"studio-change"/);
    if (marker !== -1) {
        const brace = raw.lastIndexOf('{', marker);
        if (brace !== -1) {
            const slice = extractBalancedObject(raw, brace);
            const parsed = tryParseJsonObject(slice);
            if (isStudioChangePayload(parsed)) return parsed;
        }
    }

    const firstBrace = raw.indexOf('{');
    if (firstBrace !== -1) {
        const slice = extractBalancedObject(raw, firstBrace);
        const parsed = tryParseJsonObject(slice);
        if (isStudioChangePayload(parsed)) return parsed;
    }

    return null;
}

function studioChangeEscape(text) {
    // escapeHtml: public/scripts/comp/utilities.js
    return escapeHtml(String(text == null ? '' : text));
}

function studioChangeTruncate(text, maxLen) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const limit = maxLen || 72;
    if (t.length <= limit) return t;
    return t.substring(0, limit - 1) + '…';
}

function studioChangeChunkName(text, fallback) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return fallback || 'Chunk';
    const first = t.split(',')[0].trim();
    return studioChangeTruncate(first || t, 40);
}

function joinPromptChunks(chunks) {
    return chunks
        .map((c) => String(c || '').trim())
        .filter(Boolean)
        .join(', ');
}

function appendPromptChunk(current, chunk) {
    const add = String(chunk || '').trim();
    if (!add) return current;
    const cur = String(current || '');
    if (!cur.trim()) return add;
    if (cur.includes(add)) return cur;
    const trimmed = cur.replace(/\s+$/, '');
    const sep = /,\s*$/.test(trimmed) ? ' ' : ', ';
    return trimmed + sep + add;
}

function removePromptChunk(current, chunk) {
    const target = String(chunk || '').trim();
    const cur = String(current || '');
    if (!target || !cur) return cur;
    if (!cur.includes(target)) return cur;
    let next = cur.split(target).join('');
    next = next.replace(/,\s*,/g, ',').replace(/^\s*,\s*|\s*,\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
    return next;
}

function replacePromptSpan(current, from, to) {
    const src = String(current || '');
    const find = String(from || '').trim();
    const put = String(to || '');
    if (find && src.includes(find)) return src.split(find).join(put);
    return appendPromptChunk(src, put);
}

function resolveStudioChangeResolutionPreset(value) {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower === 'custom') return null;
    // RESOLUTION_CACHE / RESOLUTIONS: public/scripts/comp/utilities.js
    const byValue = RESOLUTION_CACHE.get(lower) || RESOLUTION_CACHE.get(lower.replace(/[\s-]+/g, '_'));
    if (byValue) return byValue;
    return RESOLUTIONS.find((r) => r.display.toLowerCase() === lower) || null;
}

function studioChangeShouldSkipSizeParams(params) {
    if (!params || typeof params !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(params, 'resolution')) return false;
    return Boolean(resolveStudioChangeResolutionPreset(params.resolution));
}

function studioChangeFormatValue(id, value) {
    if (value === undefined || value === null || value === '') return '—';
    if (id === 'append_uc') {
        const n = Number(value);
        return STUDIO_CHANGE_UC_PRESET_NAMES[n] || String(value);
    }
    if (id === 'variety' || id === 'upscale' || id === 'append_quality') {
        return value ? 'On' : 'Off';
    }
    if (id === 'resolution') {
        const preset = resolveStudioChangeResolutionPreset(value);
        if (preset) return preset.display;
    }
    return String(value);
}

function studioChangeValuesEqual(id, a, b) {
    if (id === 'variety' || id === 'upscale' || id === 'append_quality') {
        return Boolean(a) === Boolean(b);
    }
    if (id === 'steps' || id === 'width' || id === 'height' || id === 'append_uc') {
        return Number(a) === Number(b);
    }
    if (id === 'guidance' || id === 'rescale' || id === 'strength' || id === 'noise') {
        return Number(a) === Number(b);
    }
    return String(a ?? '') === String(b ?? '');
}

function isStudioModalOpen() {
    const modal = document.getElementById('manualModal');
    return Boolean(modal && !modal.classList.contains('hidden'));
}

function getStudioCharacterItems() {
    const container = document.getElementById('characterPromptsContainer');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.character-prompt-item'));
}

function getStudioFieldTextarea(fieldId) {
    if (fieldId === 'prompt') return document.getElementById('manualPrompt');
    if (fieldId === 'uc') return document.getElementById('manualUc');
    if (fieldId === 'promptNegative') return document.getElementById('manualPromptNegative');
    const charMatch = /^character:(\d+):(prompt|uc|promptNegative)$/.exec(fieldId);
    if (!charMatch) return null;
    const item = getStudioCharacterItems()[Number(charMatch[1])];
    if (!item) return null;
    const suffix = charMatch[2];
    return document.getElementById(`${item.id}_${suffix}`);
}

function getStudioFieldLabel(fieldId) {
    const base = STUDIO_CHANGE_FIELD_DEFS.find((d) => d.id === fieldId);
    if (base) return base.label;
    const charMatch = /^character:(\d+):(prompt|uc|promptNegative)$/.exec(fieldId);
    if (!charMatch) return fieldId;
    const item = getStudioCharacterItems()[Number(charMatch[1])];
    const name = (item && (item.dataset.charaName || item.querySelector('.character-name-input')?.value)) || `Character ${Number(charMatch[1]) + 1}`;
    const field = charMatch[2] === 'uc' ? 'UC' : (charMatch[2] === 'promptNegative' ? 'negative' : 'prompt');
    return `${name} ${field}`;
}

function getStudioFieldValue(fieldId) {
    const textarea = getStudioFieldTextarea(fieldId);
    return textarea ? textarea.value : '';
}

function writeStudioFieldValue(fieldId, next) {
    const textarea = getStudioFieldTextarea(fieldId);
    if (!textarea) return false;
    const value = next == null ? '' : String(next);
    // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
    setTextareaValuePreservingUndo(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // applyFormattedText: public/scripts/comp/utilities.js
    applyFormattedText(textarea, true);
    // updateEmphasisHighlighting: public/scripts/comp/emphasisHighlight.js
    updateEmphasisHighlighting(textarea);
    // autoResizeTextarea: public/scripts/comp/utilities.js
    autoResizeTextarea(textarea);
    if (window.promptTextareaToolbar) window.promptTextareaToolbar.updateTokenCount(textarea);
    const charMatch = /^character:(\d+):prompt$/.exec(fieldId);
    if (charMatch) {
        const item = getStudioCharacterItems()[Number(charMatch[1])];
        if (item) {
            // updateCharacterPromptPreview: public/scripts/comp/characterPromptManager.js
            updateCharacterPromptPreview(item.id);
        }
    }
    return true;
}

function getStudioParamSnapshot() {
    // collectManualFormValues: public/scripts/comp/manualModalManager.js
    const values = collectManualFormValues();
    const seedEl = document.getElementById('manualSeed');
    const widthEl = document.getElementById('manualWidth');
    const heightEl = document.getElementById('manualHeight');
    const strengthEl = document.getElementById('manualStrengthValue');
    const noiseEl = document.getElementById('manualNoiseValue');
    const varietyBtn = document.getElementById('varietyBtn');
    return {
        steps: values.steps,
        guidance: values.guidance,
        rescale: values.rescale,
        sampler: values.sampler,
        noiseScheduler: values.noiseScheduler,
        model: values.model,
        seed: seedEl ? seedEl.value.trim() : '',
        resolution: values.resolutionValue,
        width: values.width || (widthEl ? parseInt(widthEl.value, 10) : undefined),
        height: values.height || (heightEl ? parseInt(heightEl.value, 10) : undefined),
        variety: varietyBtn ? varietyBtn.getAttribute('data-state') === 'on' : Boolean(varietyEnabled),
        upscale: values.upscale === true || values.upscale === 2,
        strength: strengthEl ? parseFloat(strengthEl.value) : undefined,
        noise: noiseEl ? parseFloat(noiseEl.value) : undefined,
        append_quality: values.append_quality,
        append_uc: values.append_uc
    };
}

function normalizeChunkEntry(entry, fallbackAction) {
    if (entry == null) return null;
    if (typeof entry === 'string') {
        const text = entry.trim();
        if (!text) return null;
        return {
            name: studioChangeChunkName(text),
            text,
            action: fallbackAction || 'replace'
        };
    }
    if (typeof entry !== 'object') return null;
    const text = String(entry.text || entry.replace || entry.value || '').trim();
    const from = String(entry.from || entry.select || entry.select_text || '').trim();
    if (!text && !from && entry.action !== 'remove') return null;
    const action = (entry.action || fallbackAction || 'replace').toLowerCase();
    return {
        name: entry.name || studioChangeChunkName(text || from),
        text: text || from,
        from: from || '',
        action
    };
}

function normalizeFieldSpec(spec, fallbackAction) {
    if (spec == null) return null;
    if (typeof spec === 'string') {
        return { action: 'replace', text: spec, chunks: [] };
    }
    if (Array.isArray(spec)) {
        const chunks = spec.map((c) => normalizeChunkEntry(c, fallbackAction || 'replace')).filter(Boolean);
        return { action: fallbackAction || 'replace', text: '', chunks };
    }
    if (typeof spec !== 'object') return null;
    const action = (spec.action || fallbackAction || 'replace').toLowerCase();
    const chunks = [];
    const pushList = (list, listAction) => {
        if (!list) return;
        const arr = Array.isArray(list) ? list : [list];
        arr.forEach((item) => {
            const chunk = normalizeChunkEntry(item, listAction);
            if (chunk) chunks.push(chunk);
        });
    };
    if (Array.isArray(spec.chunks)) {
        spec.chunks.forEach((item) => {
            const chunk = normalizeChunkEntry(item, spec.action || action);
            if (chunk) chunks.push(chunk);
        });
    }
    pushList(spec.add, 'add');
    pushList(spec.remove, 'remove');
    if (spec.replace && typeof spec.replace === 'object') {
        pushList(spec.replace, 'replace');
    }
    const text = String(spec.text || (typeof spec.replace === 'string' ? spec.replace : '') || '').trim();
    return { action, text, chunks };
}

function studioChangeNormalizeExpanderPrefix(raw) {
    let value = String(raw || '').trim();
    if (value.charAt(0) === '!') value = value.slice(1);
    return value.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function resolveStudioChangeCharacterAction(entry) {
    const explicit = entry && entry.action ? String(entry.action).toLowerCase() : '';
    if (explicit === 'remove') return 'remove';
    return 'replace';
}

function resolveStudioChangeCharIndex(entry, action, index) {
    if (entry && entry.index != null && entry.index !== '') return Number(entry.index);
    return Number(index);
}

function studioChangeCharacterPartRaw(entry, part) {
    if (part === 'promptNegative') {
        return entry.promptNegative != null ? entry.promptNegative : entry.input_prompt_negative;
    }
    return entry[part];
}

function collectStudioChangeExpanderList(payload) {
    if (!payload) return null;
    if (Object.prototype.hasOwnProperty.call(payload, 'expanders')) {
        return Array.isArray(payload.expanders) ? payload.expanders : [];
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'text_replacements')) {
        return Array.isArray(payload.text_replacements) ? payload.text_replacements : [];
    }
    return null;
}

function collectStudioChangeVibeList(payload) {
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'vibes')) return null;
    return Array.isArray(payload.vibes) ? payload.vibes : [];
}

function normalizeStudioChangeVibe(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || entry.vibe_id || entry.vibeId || '').trim();
    if (!id) return null;
    const strengthRaw = entry.strength != null ? entry.strength : entry.ie_strength;
    const strength = Number(strengthRaw);
    return {
        id,
        ie: entry.ie != null ? String(entry.ie) : '',
        strength: Number.isFinite(strength) ? strength : 0.7,
        inject_text: entry.inject_text !== false
    };
}

function buildStudioChangeVibeOps(payload) {
    const list = collectStudioChangeVibeList(payload);
    if (list == null) return [];
    const ops = [{
        key: 'vibes:policy',
        group: 'Vibes',
        kind: 'vibes-policy',
        action: 'replace',
        label: 'Replace all vibe transfers',
        enabled: true
    }];
    list.forEach((entry, index) => {
        const vibe = normalizeStudioChangeVibe(entry);
        if (!vibe) return;
        ops.push({
            key: `vibe:${vibe.id}:${index}`,
            group: 'Vibes',
            kind: 'vibe',
            action: 'set',
            vibeId: vibe.id,
            ie: vibe.ie,
            strength: vibe.strength,
            inject_text: vibe.inject_text,
            name: vibe.id,
            enabled: true
        });
    });
    return ops;
}

function normalizeStudioChangeExpander(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const prefix = studioChangeNormalizeExpanderPrefix(entry.prefix || entry.name || entry.key || '');
    const value = entry.value != null ? entry.value : entry.text;
    if (!prefix || value == null || value === '') return null;
    return {
        prefix,
        value,
        extend: Boolean(entry.extend)
    };
}

function buildStudioChangeExpanderOps(payload) {
    const list = collectStudioChangeExpanderList(payload);
    if (list == null) return [];
    const ops = [{
        key: 'expanders:policy',
        group: 'Text expanders',
        kind: 'expanders-policy',
        action: 'replace',
        label: 'Replace all request expanders',
        enabled: true
    }];
    list.forEach((entry, index) => {
        const expander = normalizeStudioChangeExpander(entry);
        if (!expander) return;
        ops.push({
            key: `expander:${expander.prefix}:${index}`,
            group: 'Text expanders',
            kind: 'expander',
            action: 'set',
            prefix: expander.prefix,
            value: expander.value,
            extend: expander.extend,
            name: `!${expander.prefix}`,
            enabled: true
        });
    });
    return ops;
}

function expandFieldChunks(fieldId, spec) {
    if (!spec) return [];
    let chunks = spec.chunks.slice();
    if (!chunks.length && spec.text) {
        chunks = [{
            name: spec.action === 'remove' ? studioChangeChunkName(spec.text) : 'Full text',
            text: spec.text,
            from: '',
            action: spec.action || 'replace'
        }];
    }
    return chunks.map((chunk, index) => ({
        key: `field:${fieldId}:${index}:${chunk.action}`,
        group: getStudioFieldLabel(fieldId),
        kind: 'chunk',
        action: chunk.action,
        fieldId,
        name: chunk.name,
        text: chunk.text,
        from: chunk.from || '',
        enabled: true,
        found: chunk.action === 'add' || chunk.action === 'replace'
            ? true
            : getStudioFieldValue(fieldId).includes(chunk.from || chunk.text)
    }));
}

function buildOpsFromPayload(payload) {
    const ops = [];
    if (!payload) return ops;
    const currentParams = getStudioParamSnapshot();
    const params = payload.params && typeof payload.params === 'object' ? payload.params : {};

    const skipSize = studioChangeShouldSkipSizeParams(params);
    STUDIO_CHANGE_PARAM_DEFS.forEach((def) => {
        if (!Object.prototype.hasOwnProperty.call(params, def.id)) return;
        if (skipSize && (def.id === 'width' || def.id === 'height')) return;
        let next = params[def.id];
        if (next === undefined) return;
        if (def.id === 'resolution') {
            const preset = resolveStudioChangeResolutionPreset(next);
            if (preset) next = preset.value;
        }
        const current = currentParams[def.id];
        ops.push({
            key: `param:${def.id}`,
            group: 'Parameters',
            kind: 'param',
            action: 'set',
            paramId: def.id,
            label: def.label,
            fromValue: current,
            toValue: next,
            enabled: true,
            unchanged: studioChangeValuesEqual(def.id, current, next)
        });
    });

    const fieldSpecs = [];
    if (Array.isArray(payload.fields)) {
        payload.fields.forEach((field) => {
            if (!field || !field.id) return;
            const spec = normalizeFieldSpec(field, field.action);
            if (spec) fieldSpecs.push({ id: field.id, spec });
        });
    }
    ['prompt', 'uc', 'promptNegative'].forEach((id) => {
        if (payload[id] == null) return;
        const spec = normalizeFieldSpec(payload[id]);
        if (spec) fieldSpecs.push({ id, spec });
    });

    const characters = Array.isArray(payload.characters) ? payload.characters : [];
    const coveredCharacterFields = new Set();
    characters.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const action = resolveStudioChangeCharacterAction(entry);
        if (action !== 'add' && action !== 'replace') return;
        const charIndex = resolveStudioChangeCharIndex(entry, action, index);
        const slots = action === 'add' ? [`add:${index}`] : [String(charIndex)];
        ['prompt', 'uc', 'promptNegative'].forEach((part) => {
            if (studioChangeCharacterPartRaw(entry, part) == null) return;
            slots.forEach((slot) => coveredCharacterFields.add(`character:${slot}:${part}`));
            if (charIndex >= 0) coveredCharacterFields.add(`character:${charIndex}:${part}`);
        });
    });

    fieldSpecs.forEach(({ id, spec }) => {
        if (coveredCharacterFields.has(id)) return;
        expandFieldChunks(id, spec).forEach((op) => ops.push(op));
    });

    buildStudioChangeExpanderOps(payload).forEach((op) => ops.push(op));
    buildStudioChangeVibeOps(payload).forEach((op) => ops.push(op));

    characters.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const action = resolveStudioChangeCharacterAction(entry);
        const charIndex = resolveStudioChangeCharIndex(entry, action, index);
        const name = entry.name || entry.chara_name || '';
        if (action === 'remove') {
            ops.push({
                key: `character:remove:${charIndex}:${index}`,
                group: 'Characters',
                kind: 'character',
                action: 'remove',
                charIndex,
                payloadIndex: index,
                name: name || getStudioFieldLabel(`character:${charIndex}:prompt`),
                enabled: true
            });
            return;
        }
        if (action === 'add' || action === 'replace') {
            const promptText = typeof entry.prompt === 'string' ? entry.prompt : '';
            const ucText = typeof entry.uc === 'string' ? entry.uc : '';
            const promptNegativeRaw = studioChangeCharacterPartRaw(entry, 'promptNegative');
            const promptNegativeText = typeof promptNegativeRaw === 'string' ? promptNegativeRaw : '';
            ops.push({
                key: `character:${action}:${charIndex}:${index}`,
                group: 'Characters',
                kind: 'character',
                action,
                charIndex,
                payloadIndex: index,
                name: name || (action === 'add' ? 'New character' : `Character ${charIndex + 1}`),
                prompt: promptText,
                uc: ucText,
                promptNegative: promptNegativeText,
                enabled: true
            });
            ['prompt', 'uc', 'promptNegative'].forEach((part) => {
                const raw = studioChangeCharacterPartRaw(entry, part);
                if (raw == null || typeof raw === 'string') return;
                const spec = normalizeFieldSpec(raw);
                if (!spec) return;
                const fieldId = action === 'add'
                    ? `character:add:${index}:${part}`
                    : `character:${charIndex}:${part}`;
                const groupName = `${name || (action === 'add' ? 'New character' : `Character ${charIndex + 1}`)} ${part === 'uc' ? 'UC' : (part === 'promptNegative' ? 'negative' : 'prompt')}`;
                expandFieldChunks(fieldId, spec).forEach((op) => {
                    op.charIndex = charIndex;
                    op.payloadIndex = index;
                    op.pendingCharacter = action === 'add';
                    op.group = groupName;
                    ops.push(op);
                });
            });
        }
    });

    return ops;
}

function buildPayloadFromOps(ops, title) {
    const payload = {
        dreamscape: STUDIO_CHANGE_KIND,
        v: STUDIO_CHANGE_VERSION
    };
    if (title) payload.title = title;

    const params = {};
    const fieldMap = new Map();
    const characters = [];
    const expanders = [];
    const vibes = [];
    const characterChunkMap = new Map();
    let replaceExpanders = false;
    let replaceVibes = false;

    ops.filter((op) => op.enabled !== false).forEach((op) => {
        if (op.kind === 'param') {
            params[op.paramId] = op.toValue;
            return;
        }
        if (op.kind === 'expanders-policy') {
            replaceExpanders = true;
            return;
        }
        if (op.kind === 'expander') {
            const entry = { prefix: op.prefix, value: op.value };
            if (op.extend) entry.extend = true;
            expanders.push(entry);
            return;
        }
        if (op.kind === 'vibes-policy') {
            replaceVibes = true;
            return;
        }
        if (op.kind === 'vibe') {
            const entry = { id: op.vibeId };
            if (op.ie) entry.ie = op.ie;
            if (op.strength != null) entry.strength = op.strength;
            if (op.inject_text === false) entry.inject_text = false;
            vibes.push(entry);
            return;
        }
        if (op.kind === 'character') {
            const entry = { action: op.action };
            if (op.charIndex >= 0) entry.index = op.charIndex;
            if (op.name) entry.name = op.name;
            if (op.prompt) entry.prompt = op.prompt;
            if (op.uc) entry.uc = op.uc;
            if (op.promptNegative) entry.promptNegative = op.promptNegative;
            characters.push(entry);
            return;
        }
        if (op.kind === 'chunk') {
            const charField = /^character:(?:add:)?(\d+):(prompt|uc|promptNegative)$/.exec(op.fieldId)
                || /^character:(new|-1):(prompt|uc|promptNegative)$/.exec(op.fieldId);
            const chunk = { name: op.name, text: op.text, action: op.action };
            if (op.from) chunk.from = op.from;
            if (charField) {
                const slotKey = `${charField[1]}:${charField[2]}`;
                if (!characterChunkMap.has(slotKey)) characterChunkMap.set(slotKey, []);
                characterChunkMap.get(slotKey).push(chunk);
                return;
            }
            if (!fieldMap.has(op.fieldId)) {
                fieldMap.set(op.fieldId, { id: op.fieldId, chunks: [] });
            }
            const field = fieldMap.get(op.fieldId);
            field.chunks.push(chunk);
            const actions = new Set(field.chunks.map((c) => c.action));
            field.action = actions.size === 1 ? [...actions][0] : 'replace';
        }
    });

    characterChunkMap.forEach((chunks, slotKey) => {
        const match = /^(\d+|new|-1):(prompt|uc|promptNegative)$/.exec(slotKey);
        if (!match) return;
        const part = match[2];
        let entry = null;
        if (match[1] === 'new' || match[1] === '-1') {
            entry = characters.find((item) => item.action === 'add' && item.index == null) || characters.find((item) => item.action === 'add');
        } else {
            const idx = Number(match[1]);
            entry = characters.find((item) => item.index === idx);
            if (!entry) {
                entry = { action: 'replace', index: idx };
                characters.push(entry);
            }
        }
        if (!entry) return;
        if (typeof entry[part] === 'string' && entry[part]) return;
        const actions = new Set(chunks.map((c) => c.action));
        entry[part] = { action: actions.size === 1 ? [...actions][0] : 'replace', chunks };
    });

    if (studioChangeShouldSkipSizeParams(params)) {
        delete params.width;
        delete params.height;
    }
    if (Object.keys(params).length) payload.params = params;
    if (replaceExpanders) payload.expanders = expanders;
    if (replaceVibes) payload.vibes = vibes;
    if (fieldMap.size) payload.fields = Array.from(fieldMap.values());
    if (characters.length) payload.characters = characters;
    return payload;
}

function buildExportOpsFromStudio() {
    const ops = [];
    const params = getStudioParamSnapshot();
    const skipSize = studioChangeShouldSkipSizeParams(params);
    STUDIO_CHANGE_PARAM_DEFS.forEach((def) => {
        const value = params[def.id];
        if (value === undefined || value === null || value === '') return;
        if (skipSize && (def.id === 'width' || def.id === 'height')) return;
        ops.push({
            key: `param:${def.id}`,
            group: 'Parameters',
            kind: 'param',
            action: 'set',
            paramId: def.id,
            label: def.label,
            fromValue: value,
            toValue: value,
            enabled: true,
            unchanged: true
        });
    });

    STUDIO_CHANGE_FIELD_DEFS.forEach((def) => {
        const value = getStudioFieldValue(def.id);
        if (!value || !String(value).trim()) return;
        ops.push({
            key: `field:${def.id}:0:replace`,
            group: def.label,
            kind: 'chunk',
            action: 'replace',
            fieldId: def.id,
            name: def.label,
            text: value,
            from: '',
            enabled: true,
            found: true
        });
    });

    getStudioCharacterItems().forEach((item, index) => {
        const name = (item.dataset.charaName || (item.querySelector('.character-name-input') && item.querySelector('.character-name-input').value) || `Character ${index + 1}`).trim();
        const prompt = getStudioFieldValue(`character:${index}:prompt`);
        const uc = getStudioFieldValue(`character:${index}:uc`);
        const promptNegative = getStudioFieldValue(`character:${index}:promptNegative`);
        if (!name && !prompt && !uc && !promptNegative) return;
        ops.push({
            key: `character:replace:${index}`,
            group: 'Characters',
            kind: 'character',
            action: 'replace',
            charIndex: index,
            payloadIndex: index,
            name: name || `Character ${index + 1}`,
            prompt,
            uc,
            promptNegative,
            enabled: true
        });
    });

    // collectVibeTransferData: public/scripts/comp/manualModalManager.js
    if (typeof collectVibeTransferData === 'function') {
        const currentVibes = collectVibeTransferData() || [];
        if (currentVibes.length) {
            ops.push({
                key: 'vibes:policy',
                group: 'Vibes',
                kind: 'vibes-policy',
                action: 'replace',
                label: 'Replace all vibe transfers',
                enabled: true
            });
            currentVibes.forEach((entry, index) => {
                const vibe = normalizeStudioChangeVibe(entry);
                if (!vibe) return;
                ops.push({
                    key: `vibe:${vibe.id}:${index}`,
                    group: 'Vibes',
                    kind: 'vibe',
                    action: 'set',
                    vibeId: vibe.id,
                    ie: vibe.ie,
                    strength: vibe.strength,
                    inject_text: vibe.inject_text,
                    name: vibe.id,
                    enabled: true
                });
            });
        }
    }

    // requestBodyReplacements: public/scripts/comp/requestBodyReplacementsModal.js
    if (requestBodyReplacements.length) {
        ops.push({
            key: 'expanders:policy',
            group: 'Text expanders',
            kind: 'expanders-policy',
            action: 'replace',
            label: 'Replace all request expanders',
            enabled: true
        });
        requestBodyReplacements.forEach((entry, index) => {
            const expander = normalizeStudioChangeExpander(entry);
            if (!expander) return;
            ops.push({
                key: `expander:${expander.prefix}:${index}`,
                group: 'Text expanders',
                kind: 'expander',
                action: 'set',
                prefix: expander.prefix,
                value: expander.value,
                extend: expander.extend,
                name: `!${expander.prefix}`,
                enabled: true
            });
        });
    }

    return ops;
}

function studioChangeActionBadge(action) {
    const map = {
        add: 'Add',
        remove: 'Remove',
        replace: 'Replace',
        set: 'Set'
    };
    return map[action] || action;
}

function renderStudioChangeOpRow(op) {
    const on = op.enabled !== false;
    const icon = on ? 'fas fa-check' : 'far fa-square';
    let title = '';
    let detail = '';
    if (op.kind === 'param') {
        title = op.label;
        detail = op.unchanged
            ? studioChangeFormatValue(op.paramId, op.toValue)
            : `${studioChangeFormatValue(op.paramId, op.fromValue)} → ${studioChangeFormatValue(op.paramId, op.toValue)}`;
    } else if (op.kind === 'character') {
        title = op.name || 'Character';
        detail = op.action === 'remove'
            ? 'Remove this character slot'
            : (op.prompt || op.uc ? studioChangeTruncate(op.prompt || op.uc, 90) : 'Add character slot');
    } else if (op.kind === 'expanders-policy') {
        title = op.label || 'Replace all request expanders';
        detail = 'Clears current request expanders, then installs the prefixes below';
    } else if (op.kind === 'expander') {
        title = op.name || `!${op.prefix}`;
        detail = studioChangeTruncate(Array.isArray(op.value) ? op.value.join(' | ') : op.value, 110);
    } else if (op.kind === 'vibes-policy') {
        title = op.label || 'Replace all vibe transfers';
        detail = 'Clears current vibe transfers, then installs the ids below';
    } else if (op.kind === 'vibe') {
        title = op.name || op.vibeId || 'Vibe';
        detail = studioChangeTruncate(`${op.ie || 'ie?'} · strength ${op.strength}${op.inject_text === false ? ' · no text' : ''}`, 110);
    } else {
        title = op.name || 'Chunk';
        detail = studioChangeTruncate(op.from && op.action === 'replace'
            ? `${op.from} → ${op.text}`
            : op.text, 110);
        if (op.action === 'remove' && op.found === false) {
            detail += ' (not in current text)';
        }
    }
    const missing = op.kind === 'chunk' && op.action === 'remove' && op.found === false;
    return `
        <div class="studio-change-row${on ? ' is-on' : ''}${missing ? ' is-missing' : ''}" data-op-key="${studioChangeEscape(op.key)}" data-state="${on ? 'on' : 'off'}">
            <span class="studio-change-row-toggle btn-secondary btn-small toggle-btn" data-state="${on ? 'on' : 'off'}">
                <i class="${icon}"></i>
            </span>
            <span class="studio-change-row-body">
                <span class="studio-change-row-title">
                    <span class="studio-change-badge studio-change-badge-${studioChangeEscape(op.action)}">${studioChangeEscape(studioChangeActionBadge(op.action))}</span>
                    ${studioChangeEscape(title)}
                </span>
                <span class="studio-change-row-detail">${studioChangeEscape(detail)}</span>
            </span>
        </div>
    `;
}

function renderStudioChangeDialogHtml(ops, options) {
    const title = options.title ? `<p class="studio-change-lead">${studioChangeEscape(options.title)}</p>` : '';
    const hint = options.hint ? `<p class="studio-change-hint">${studioChangeEscape(options.hint)}</p>` : '';
    const groups = [];
    const seen = new Set();
    ops.forEach((op) => {
        if (seen.has(op.group)) return;
        seen.add(op.group);
        groups.push(op.group);
    });
    const sections = groups.map((group) => {
        const rows = ops.filter((op) => op.group === group).map(renderStudioChangeOpRow).join('');
        return `
            <section class="studio-change-group">
                <h3 class="studio-change-group-title">${studioChangeEscape(group)}</h3>
                <div class="studio-change-group-rows">${rows}</div>
            </section>
        `;
    }).join('');
    const empty = ops.length ? '' : '<p class="studio-change-hint">Nothing to include.</p>';
    return `
        <div class="studio-change-dialog">
            ${title}
            ${hint}
            <div class="studio-change-toolbar">
                <button type="button" class="btn-secondary btn-small" data-studio-change="all">Select all</button>
                <button type="button" class="btn-secondary btn-small" data-studio-change="none">Select none</button>
            </div>
            <div class="studio-change-scroll-shell scrollbar-padding" data-custom-scrollbar data-scrollable-wrapper-class="studio-change-scrollable">
                <div class="studio-change-scroll-inner">
                    ${sections || empty}
                </div>
            </div>
        </div>
    `;
}

function readStudioChangeOpsFromDialog(dialog, ops) {
    if (!dialog) return ops;
    dialog.querySelectorAll('.studio-change-row[data-op-key]').forEach((row) => {
        const key = row.getAttribute('data-op-key');
        const op = ops.find((item) => item.key === key);
        if (op) op.enabled = row.getAttribute('data-state') !== 'off';
    });
    return ops;
}

function setStudioChangeRowState(row, on) {
    row.setAttribute('data-state', on ? 'on' : 'off');
    row.classList.toggle('is-on', on);
    const toggle = row.querySelector('.studio-change-row-toggle');
    const icon = row.querySelector('.studio-change-row-toggle i');
    if (toggle) toggle.setAttribute('data-state', on ? 'on' : 'off');
    if (icon) icon.className = on ? 'fas fa-check' : 'far fa-square';
}

function cleanupStudioChangeWindowControls(dialog) {
    if (!dialog) return;
    dialog.querySelectorAll('.studio-change-window-btn').forEach((el) => el.remove());
    dialog.classList.remove(STUDIO_CHANGE_DIALOG_CLASS);
}

function wireStudioChangeWindowControls(dialog, ops, signal, options) {
    cleanupStudioChangeWindowControls(dialog);
    dialog.classList.add(STUDIO_CHANGE_DIALOG_CLASS);
    const controls = dialog.querySelector('.modal-window-controls');
    const closeBtn = controls && controls.querySelector('.close-btn');
    if (!controls || !closeBtn) return;

    const desktopBtn = document.createElement('button');
    desktopBtn.type = 'button';
    desktopBtn.className = 'btn-secondary btn-small studio-change-window-btn';
    desktopBtn.title = 'Add to Desktop';
    desktopBtn.innerHTML = '<i class="fas fa-arrow-down-left"></i>';

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'btn-secondary minimize-btn btn-small studio-change-window-btn';
    minBtn.title = 'Minimize';
    minBtn.innerHTML = '<i class="fa-regular fa-window-minimize"></i>';

    controls.insertBefore(desktopBtn, closeBtn);
    controls.insertBefore(minBtn, closeBtn);

    const opts = signal ? { signal } : undefined;
    desktopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const current = readStudioChangeOpsFromDialog(dialog, ops);
        const enabledOps = current.filter((op) => op.enabled !== false);
        if (!enabledOps.length) {
            showGlassToast('info', 'Studio change', 'Nothing selected', false, 2500, '<i class="fas fa-info-circle"></i>');
            return;
        }
        const payload = buildPayloadFromOps(enabledOps, options && options.saveTitle);
        void saveStudioChangeToDesktop(payload, options && options.saveTitle);
    }, opts);

    if (signal) {
        signal.addEventListener('abort', () => cleanupStudioChangeWindowControls(dialog), { once: true });
    }
}

function wireStudioChangeDialog(dialog, ops, signal, options) {
    wireStudioChangeWindowControls(dialog, ops, signal, options || {});
    const opts = signal ? { signal } : undefined;
    dialog.querySelectorAll('.studio-change-row[data-op-key]').forEach((row) => {
        row.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setStudioChangeRowState(row, row.getAttribute('data-state') !== 'on');
        }, opts);
    });
    const allBtn = dialog.querySelector('[data-studio-change="all"]');
    const noneBtn = dialog.querySelector('[data-studio-change="none"]');
    if (allBtn) {
        allBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dialog.querySelectorAll('.studio-change-row[data-op-key]').forEach((row) => setStudioChangeRowState(row, true));
        }, opts);
    }
    if (noneBtn) {
        noneBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dialog.querySelectorAll('.studio-change-row[data-op-key]').forEach((row) => setStudioChangeRowState(row, false));
        }, opts);
    }
    const shell = dialog.querySelector('.studio-change-scroll-shell');
    if (shell && customScrollbar && customScrollbar.forceReinit) {
        setTimeout(() => customScrollbar.forceReinit(shell), 0);
    }
}

async function ensureStudioOpenForChange() {
    const modal = document.getElementById('manualModal');
    if (!modal) return;
    if (!modal.classList.contains('hidden')) return;
    // openModal / setActiveWindow: public/scripts/comp/modalUtils.js
    openModal(modal);
    setActiveWindow(modal);
}

function ensureStudioCharacterCount(minCount) {
    while (getStudioCharacterItems().length < minCount) {
        // addCharacterPrompt: public/scripts/comp/characterPromptManager.js
        addCharacterPrompt();
    }
}

function setStudioCharacterName(index, name) {
    if (!name) return;
    const item = getStudioCharacterItems()[index];
    if (!item) return;
    item.dataset.charaName = name;
    const input = item.querySelector('.character-name-input');
    const placeholder = item.querySelector('.character-name-input-placeholder');
    if (input) input.value = name;
    if (placeholder) placeholder.textContent = name;
}

async function applyStudioParam(paramId, value) {
    const stepsEl = document.getElementById('manualSteps');
    const guidanceEl = document.getElementById('manualGuidance');
    const rescaleEl = document.getElementById('manualRescale');
    const seedEl = document.getElementById('manualSeed');
    const widthEl = document.getElementById('manualWidth');
    const heightEl = document.getElementById('manualHeight');
    const strengthEl = document.getElementById('manualStrengthValue');
    const noiseEl = document.getElementById('manualNoiseValue');
    const varietyBtn = document.getElementById('varietyBtn');
    const upscaleEl = document.getElementById('manualUpscale');

    const ping = (el) => {
        if (!el) return;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    switch (paramId) {
        case 'steps':
            if (stepsEl) {
                stepsEl.value = parseInt(value, 10) || 1;
                ping(stepsEl);
            }
            break;
        case 'guidance':
            if (guidanceEl) {
                const n = Number(value);
                guidanceEl.value = Number.isFinite(n) ? (n >= 10 ? String(n) : n.toFixed(2)) : value;
                ping(guidanceEl);
            }
            break;
        case 'rescale':
            if (rescaleEl) {
                const n = Number(value);
                rescaleEl.value = Number.isFinite(n) ? n.toFixed(2) : value;
                ping(rescaleEl);
            }
            break;
        case 'sampler':
            // selectManualSampler: public/scripts/comp/manualDropdownManager.js
            selectManualSampler(value);
            break;
        case 'noiseScheduler':
            // selectManualNoiseScheduler: public/scripts/comp/manualDropdownManager.js
            selectManualNoiseScheduler(value);
            break;
        case 'model':
            // selectManualModel: public/scripts/comp/manualDropdownManager.js
            selectManualModel(value, '', true);
            break;
        case 'seed':
            if (seedEl) {
                seedEl.value = value == null ? '' : String(value);
                ping(seedEl);
            }
            break;
        case 'resolution': {
            const preset = resolveStudioChangeResolutionPreset(value);
            // selectManualResolution: public/scripts/comp/manualDropdownManager.js
            await selectManualResolution(preset ? preset.value : String(value).toLowerCase());
            break;
        }
        case 'width':
            if (widthEl) {
                widthEl.value = parseInt(value, 10) || '';
                ping(widthEl);
            }
            break;
        case 'height':
            if (heightEl) {
                heightEl.value = parseInt(value, 10) || '';
                ping(heightEl);
            }
            break;
        case 'variety': {
            const on = Boolean(value);
            if (varietyBtn) varietyBtn.setAttribute('data-state', on ? 'on' : 'off');
            varietyEnabled = on;
            break;
        }
        case 'upscale':
            if (upscaleEl) upscaleEl.setAttribute('data-state', value ? 'on' : 'off');
            break;
        case 'strength':
            if (strengthEl) {
                strengthEl.value = Number(value);
                ping(strengthEl);
            }
            break;
        case 'noise':
            if (noiseEl) {
                noiseEl.value = Number(value);
                ping(noiseEl);
            }
            break;
        case 'append_quality':
            appendQuality = Boolean(value);
            // renderDatasetDropdown / updateSubTogglesButtonState: public/scripts/comp/manualDropdownManager.js
            renderDatasetDropdown();
            updateSubTogglesButtonState();
            break;
        case 'append_uc':
            // selectUcPreset / renderUcPresetsDropdown: public/scripts/comp/manualDropdownManager.js
            selectUcPreset(Number(value));
            renderUcPresetsDropdown();
            break;
        default:
            break;
    }
    // updateManualPriceDisplay: public/scripts/comp/utilities.js
    updateManualPriceDisplay(true);
}

async function applyStudioChangeOps(ops) {
    const enabled = ops.filter((op) => op.enabled !== false);
    const hasResolutionPreset = enabled.some((op) => (
        op.kind === 'param' && op.paramId === 'resolution' && resolveStudioChangeResolutionPreset(op.toValue)
    ));
    const hasCustomSize = enabled.some((op) => op.kind === 'param' && (op.paramId === 'width' || op.paramId === 'height'));
    const hasResolution = enabled.some((op) => op.kind === 'param' && op.paramId === 'resolution');
    if (hasCustomSize && !hasResolution && !hasResolutionPreset) {
        await applyStudioParam('resolution', 'custom');
    }
    for (const op of enabled.filter((item) => item.kind === 'param')) {
        if (hasResolutionPreset && (op.paramId === 'width' || op.paramId === 'height')) continue;
        await applyStudioParam(op.paramId, op.toValue);
    }

    if (enabled.some((op) => op.kind === 'expanders-policy')) {
        const nextExpanders = enabled.filter((op) => op.kind === 'expander').map((op) => ({
            name: op.prefix,
            value: op.value,
            extend: Boolean(op.extend)
        }));
        // requestBodyReplacements / renderRequestBodyReplacementsList: public/scripts/comp/requestBodyReplacementsModal.js
        requestBodyReplacements = nextExpanders;
        renderRequestBodyReplacementsList();
    }

    if (enabled.some((op) => op.kind === 'vibes-policy')) {
        // clearAllVibeReferenceItems / addVibeReferenceToContainer: public/scripts/comp/referenceManager.js
        if (typeof clearAllVibeReferenceItems === 'function') clearAllVibeReferenceItems();
        const nextVibes = enabled.filter((op) => op.kind === 'vibe');
        for (const op of nextVibes) {
            if (typeof addVibeReferenceToContainer !== 'function') break;
            const textState = op.inject_text === false ? 'off' : 'on';
            await addVibeReferenceToContainer(op.vibeId, op.ie || null, op.strength, textState);
        }
    }

    enabled.filter((op) => op.kind === 'character' && op.action === 'remove').sort((a, b) => b.charIndex - a.charIndex).forEach((op) => {
        const item = getStudioCharacterItems()[op.charIndex];
        if (item) {
            // deleteCharacterPrompt: public/scripts/comp/characterPromptManager.js
            deleteCharacterPrompt(item.id);
        }
    });

    const addedByPayloadIndex = new Map();
    const writtenCharacterFields = new Set();
    enabled.filter((op) => op.kind === 'character' && op.action === 'add').forEach((op) => {
        const before = getStudioCharacterItems().length;
        addCharacterPrompt();
        const newIndex = before;
        addedByPayloadIndex.set(op.payloadIndex != null ? op.payloadIndex : newIndex, newIndex);
        if (op.name) setStudioCharacterName(newIndex, op.name);
        if (op.prompt) {
            writeStudioFieldValue(`character:${newIndex}:prompt`, op.prompt);
            writtenCharacterFields.add(`character:${newIndex}:prompt`);
        }
        if (op.uc) {
            writeStudioFieldValue(`character:${newIndex}:uc`, op.uc);
            writtenCharacterFields.add(`character:${newIndex}:uc`);
        }
        if (op.promptNegative) {
            writeStudioFieldValue(`character:${newIndex}:promptNegative`, op.promptNegative);
            writtenCharacterFields.add(`character:${newIndex}:promptNegative`);
        }
        op.createdIndex = newIndex;
    });

    enabled.filter((op) => op.kind === 'character' && op.action === 'replace').forEach((op) => {
        ensureStudioCharacterCount(op.charIndex + 1);
        if (op.name) setStudioCharacterName(op.charIndex, op.name);
        if (op.prompt) {
            writeStudioFieldValue(`character:${op.charIndex}:prompt`, op.prompt);
            writtenCharacterFields.add(`character:${op.charIndex}:prompt`);
        }
        if (op.uc) {
            writeStudioFieldValue(`character:${op.charIndex}:uc`, op.uc);
            writtenCharacterFields.add(`character:${op.charIndex}:uc`);
        }
        if (op.promptNegative) {
            writeStudioFieldValue(`character:${op.charIndex}:promptNegative`, op.promptNegative);
            writtenCharacterFields.add(`character:${op.charIndex}:promptNegative`);
        }
    });

    const chunkOps = enabled.filter((op) => op.kind === 'chunk').map((op) => {
        const addMatch = /^character:add:(\d+):(prompt|uc|promptNegative)$/.exec(op.fieldId);
        if (addMatch) {
            const created = addedByPayloadIndex.get(Number(addMatch[1]));
            if (created == null) return op;
            return Object.assign({}, op, { fieldId: `character:${created}:${addMatch[2]}` });
        }
        const legacyMatch = /^character:(new|-1):(prompt|uc|promptNegative)$/.exec(op.fieldId);
        if (legacyMatch && op.payloadIndex != null && addedByPayloadIndex.has(op.payloadIndex)) {
            return Object.assign({}, op, {
                fieldId: `character:${addedByPayloadIndex.get(op.payloadIndex)}:${legacyMatch[2]}`
            });
        }
        return op;
    });
    const maxChar = chunkOps.reduce((max, op) => {
        const match = /^character:(\d+):/.exec(op.fieldId);
        if (!match) return max;
        return Math.max(max, Number(match[1]) + 1);
    }, 0);
    if (maxChar) ensureStudioCharacterCount(maxChar);

    const byField = new Map();
    chunkOps.forEach((op) => {
        if (!byField.has(op.fieldId)) byField.set(op.fieldId, []);
        byField.get(op.fieldId).push(op);
    });
    byField.forEach((fieldOps, fieldId) => {
        if (writtenCharacterFields.has(fieldId)) return;
        const allReplace = fieldOps.every((op) => op.action === 'replace' && !op.from);
        let next = getStudioFieldValue(fieldId);
        if (allReplace) {
            next = joinPromptChunks(fieldOps.map((op) => op.text));
        } else {
            fieldOps.forEach((op) => {
                if (op.action === 'remove') next = removePromptChunk(next, op.from || op.text);
                else if (op.action === 'replace' && op.from) next = replacePromptSpan(next, op.from, op.text);
                else if (op.action === 'replace') next = replacePromptSpan(next, op.text, op.text);
                else next = appendPromptChunk(next, op.text);
            });
        }
        writeStudioFieldValue(fieldId, next);
    });

    return enabled.length;
}

async function saveStudioChangeToDesktop(payload, suggestedName) {
    // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
    const title = String(suggestedName || payload.title || 'Studio Change').trim() || 'Studio Change';
    payload.title = title;
    await desktopShortcuts.addShortcut({
        type: 'studio-change',
        name: title,
        data: { payload }
    });
    showGlassToast('success', 'Desktop', `Saved “${title}”`, false, 2500, '<i class="fas fa-arrow-down-left"></i>');
    return true;
}

async function copyStudioChangeText(text, successMessage) {
    // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
    try {
        await copyTextToClipboard(text);
        showGlassToast('success', 'Copied', successMessage, false, 2500, '<i class="fa-regular fa-clipboard"></i>');
        return true;
    } catch (_) {
        showGlassToast('error', 'Copy failed', 'Could not copy to clipboard', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
        return false;
    }
}

async function showStudioChangeDialog(ops, options) {
    if (!ops.length) {
        showGlassToast('info', 'Studio change', options.emptyMessage || 'Nothing to apply', false, 2500, '<i class="fas fa-info-circle"></i>');
        return null;
    }
    const buttons = options.buttons || [
        { text: 'Apply', value: 'apply', className: 'btn-primary', icon: 'fas fa-check', primary: true },
        { text: 'Cancel', value: null, className: 'btn-secondary' }
    ];
    const result = await showConfirmationDialog(
        renderStudioChangeDialogHtml(ops, options),
        buttons,
        null,
        {
            title: options.dialogTitle || 'Apply studio change',
            icon: options.icon || 'fas fa-brackets-curly',
            width: 560,
            showCloseButton: true,
            onDialogReady: (signal) => {
                const dialog = document.getElementById('confirmationDialog');
                if (dialog) wireStudioChangeDialog(dialog, ops, signal, options);
            },
            resolveValue: (value, dialog) => {
                cleanupStudioChangeWindowControls(dialog);
                if (value == null || value === false) return null;
                return {
                    action: value,
                    ops: readStudioChangeOpsFromDialog(dialog, ops)
                };
            }
        }
    );
    return result;
}

async function applyStudioChangePayload(payload, options) {
    if (studioChangeDialogBusy) return false;
    studioChangeDialogBusy = true;
    try {
        await ensureStudioOpenForChange();
        const ops = buildOpsFromPayload(payload);
        const result = await showStudioChangeDialog(ops, {
            dialogTitle: payload.title ? `Apply: ${payload.title}` : 'Apply studio change',
            title: payload.title || '',
            saveTitle: payload.title || '',
            emptyMessage: 'This change JSON has nothing to apply.'
        });
        if (!result) return false;
        const enabledOps = result.ops.filter((op) => op.enabled !== false);
        if (!enabledOps.length) {
            showGlassToast('info', 'Studio change', 'Nothing selected', false, 2500, '<i class="fas fa-info-circle"></i>');
            return false;
        }
        const count = await applyStudioChangeOps(enabledOps);
        showGlassToast('success', 'Studio change', `Applied ${count} change${count === 1 ? '' : 's'}`, false, 2500, '<i class="fas fa-check"></i>');
        return true;
    } finally {
        studioChangeDialogBusy = false;
    }
}

async function tryApplyStudioChangeJsonFromText(text) {
    const payload = extractStudioChangeJson(text);
    if (!payload) return false;
    void applyStudioChangePayload(payload).catch((err) => {
        console.error('Studio change apply failed', err);
        showGlassToast('error', 'Studio change', err.message || 'Failed to apply', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
    });
    return true;
}

function studioChangePasteTargetAllowed(target) {
    if (!target || !target.closest) return true;
    if (target.closest('#confirmationDialog')) return false;
    if (target.closest('#manualModal')) return true;
    if (target.matches && target.matches('textarea.prompt-textarea, textarea.character-prompt-textarea')) return true;
    const typing = target.closest('input, textarea, [contenteditable="true"]');
    return !typing;
}

function handleStudioChangePaste(event) {
    if (studioChangeDialogBusy) return;
    if (!event.clipboardData) return;
    if (!studioChangePasteTargetAllowed(event.target)) return;
    const files = event.clipboardData.files;
    if (files && files.length) {
        for (let i = 0; i < files.length; i++) {
            if (files[i] && files[i].type && files[i].type.startsWith('image/')) return;
        }
    }
    const items = event.clipboardData.items;
    if (items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i] && items[i].type && items[i].type.startsWith('image/')) return;
        }
    }
    const text = event.clipboardData.getData('text/plain');
    if (!text || !extractStudioChangeJson(text)) return;
    event.preventDefault();
    event.stopPropagation();
    void tryApplyStudioChangeJsonFromText(text);
}

async function openStudioChangeExportDialog() {
    if (studioChangeDialogBusy) return;
    studioChangeDialogBusy = true;
    try {
        if (!isStudioModalOpen()) {
            await ensureStudioOpenForChange();
        }
        const ops = buildExportOpsFromStudio();
        const result = await showStudioChangeDialog(ops, {
            dialogTitle: 'Copy change JSON',
            saveTitle: 'Studio Change',
            emptyMessage: 'Studio has nothing to export yet.',
            icon: 'fas fa-brackets-curly',
            buttons: [
                { text: 'Copy JSON', value: 'copy', className: 'btn-primary', icon: 'fa-regular fa-clipboard', primary: true },
                { text: 'Copy AI spec', value: 'spec', className: 'btn-secondary', icon: 'fas fa-robot' },
                { text: 'Cancel', value: null, className: 'btn-secondary' }
            ]
        });
        if (!result) return;
        const enabledOps = result.ops.filter((op) => op.enabled !== false);
        const payload = buildPayloadFromOps(enabledOps, '');
        if (result.action === 'spec') {
            await copyStudioChangeText(STUDIO_CHANGE_AI_SPEC, 'AI format spec copied');
            return;
        }
        if (!enabledOps.length) {
            showGlassToast('info', 'Studio change', 'Nothing selected', false, 2500, '<i class="fas fa-info-circle"></i>');
            return;
        }
        await copyStudioChangeText(JSON.stringify(payload, null, 2), 'Change JSON copied');
    } finally {
        studioChangeDialogBusy = false;
    }
}

async function handleStudioChangeShortcutClick(shortcut) {
    const payload = shortcut && shortcut.data && shortcut.data.payload;
    if (!payload) {
        showGlassToast('error', 'Studio change', 'Shortcut is missing change data', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    await applyStudioChangePayload(payload);
}

document.addEventListener('paste', handleStudioChangePaste, true);


function emptyStudioChangePayload() {
    return {
        dreamscape: STUDIO_CHANGE_KIND,
        v: STUDIO_CHANGE_VERSION
    };
}

function ensureStudioChangeField(fields, fieldId, label) {
    if (fields.some((field) => field && field.id === fieldId)) return;
    let text = '';
    try {
        text = getStudioFieldValue(fieldId) || '';
    } catch (_err) {
        text = '';
    }
    fields.push({
        id: fieldId,
        action: 'replace',
        chunks: [{ name: label, text }]
    });
}

function readStudioCharacterName(item, index) {
    if (!item) return `Character ${index + 1}`;
    const input = item.querySelector && item.querySelector('.character-name-input');
    const name = (item.dataset && item.dataset.charaName) || (input && input.value) || `Character ${index + 1}`;
    return String(name).trim() || `Character ${index + 1}`;
}

/**
 * Snapshot the current Studio editor as Change-JSON v1.
 * Empty / ungenerated Studio (no open image) is valid — no filename required.
 */
function buildStudioChangeSnapshot() {
    let payload;
    try {
        payload = buildPayloadFromOps(buildExportOpsFromStudio(), '');
    } catch (_err) {
        payload = emptyStudioChangePayload();
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        payload = emptyStudioChangePayload();
    }
    if (!payload.dreamscape) payload.dreamscape = STUDIO_CHANGE_KIND;
    if (!payload.v) payload.v = STUDIO_CHANGE_VERSION;

    const fields = Array.isArray(payload.fields) ? payload.fields.slice() : [];
    ensureStudioChangeField(fields, 'prompt', 'Prompt');
    ensureStudioChangeField(fields, 'uc', 'UC');
    payload.fields = fields;

    try {
        const items = getStudioCharacterItems();
        if (items.length) {
            const characters = Array.isArray(payload.characters) ? payload.characters.slice() : [];
            items.forEach((item, index) => {
                if (characters.some((entry) => entry && entry.index === index)) return;
                characters.push({
                    index,
                    action: 'replace',
                    name: readStudioCharacterName(item, index),
                    prompt: getStudioFieldValue(`character:${index}:prompt`) || '',
                    uc: getStudioFieldValue(`character:${index}:uc`) || ''
                });
            });
            if (characters.length) payload.characters = characters;
        }
    } catch (_err) {
        // keep export-produced slots
    }

    return payload;
}

if (typeof window !== 'undefined') {
    window.tryApplyStudioChangeJsonFromText = tryApplyStudioChangeJsonFromText;
    window.extractStudioChangeJson = extractStudioChangeJson;
    window.openStudioChangeExportDialog = openStudioChangeExportDialog;
    window.handleStudioChangeShortcutClick = handleStudioChangeShortcutClick;
    window.buildStudioChangeSnapshot = buildStudioChangeSnapshot;
    window.STUDIO_CHANGE_AI_SPEC = STUDIO_CHANGE_AI_SPEC;
}
