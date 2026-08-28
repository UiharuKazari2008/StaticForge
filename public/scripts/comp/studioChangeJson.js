/**
 * Studio change JSON — paste / apply / export a compact studio delta.
 * public/scripts/comp/confirmationDialog.js
 * public/scripts/comp/desktopShortcuts.js
 * public/scripts/comp/manualModalManager.js
 * public/scripts/comp/manualDropdownManager.js
 * public/scripts/comp/characterPromptManager.js
 * public/scripts/comp/textareaUtils.js
 * public/scripts/comp/promptTextareaToolbar.js
 * public/scripts/utils/dreamscapeClipboard.js
 */

const STUDIO_CHANGE_KIND = 'change';
const STUDIO_CHANGE_VERSION = 1;
const STUDIO_CHANGE_DIALOG_CLASS = 'studio-change-dialog-modal';

const STUDIO_CHANGE_AI_SPEC = `Dreamscape studio change JSON. Paste into Studio (or a prompt field) to apply. Reply with JSON only — no markdown unless fenced as json.

{"dreamscape":"change","v":1,"title":"short name",
 "params":{"steps":28,"guidance":5,"rescale":0,"sampler":"k_euler_ancestral","noiseScheduler":"karras","model":"v5","seed":"","resolution":"normal_portrait","width":832,"height":1216,"variety":false,"upscale":false,"strength":0.8,"noise":0.1,"append_quality":true,"append_uc":3},
 "fields":[
   {"id":"prompt","action":"add","chunks":[{"name":"Lighting","text":"sunset, golden hour"}]},
   {"id":"uc","action":"remove","chunks":[{"name":"Unwanted","text":"blurry"}]},
   {"id":"prompt","action":"replace","text":"optional full-field replace"},
   {"id":"character:0:prompt","action":"add","chunks":[{"name":"Outfit","text":"school uniform","from":"optional old span"}]}
 ],
 "characters":[
   {"action":"add","name":"Alice","prompt":"...","uc":"..."},
   {"index":0,"action":"remove"}
 ]}

Field ids: prompt | uc | promptNegative | character:N:prompt | character:N:uc | character:N:promptNegative
Field/chunk action: add | remove | replace. Chunk {name,text,action?,from?} — from+text replaces that span.
Omit unused keys. Only include params you want to change. Named chunks are shown as checkable rows on apply.`;

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

function splitPromptIntoChunks(text) {
    const src = String(text || '');
    if (!src.trim()) return [];
    const parts = src.split(',');
    const merged = [];
    let buf = '';
    parts.forEach((part, index) => {
        buf = buf ? `${buf},${part}` : part;
        const delimCount = (buf.match(/::/g) || []).length;
        if (delimCount % 2 === 0 || index === parts.length - 1) {
            const trimmed = buf.trim();
            if (trimmed) merged.push(trimmed);
            buf = '';
        }
    });
    return merged;
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

function studioChangeFormatValue(id, value) {
    if (value === undefined || value === null || value === '') return '—';
    if (id === 'append_uc') {
        const n = Number(value);
        return STUDIO_CHANGE_UC_PRESET_NAMES[n] || String(value);
    }
    if (id === 'variety' || id === 'upscale' || id === 'append_quality') {
        return value ? 'On' : 'Off';
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
            action: fallbackAction || 'add'
        };
    }
    if (typeof entry !== 'object') return null;
    const text = String(entry.text || entry.replace || entry.value || '').trim();
    const from = String(entry.from || entry.select || entry.select_text || '').trim();
    if (!text && !from && entry.action !== 'remove') return null;
    const action = (entry.action || fallbackAction || (from ? 'replace' : 'add')).toLowerCase();
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
        const chunks = spec.map((c) => normalizeChunkEntry(c, fallbackAction || 'add')).filter(Boolean);
        return { action: fallbackAction || 'add', text: '', chunks };
    }
    if (typeof spec !== 'object') return null;
    const action = (spec.action || fallbackAction || (spec.replace || spec.text ? 'replace' : 'add')).toLowerCase();
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

function expandFieldChunks(fieldId, spec) {
    if (!spec) return [];
    let chunks = spec.chunks.slice();
    if (!chunks.length && spec.text) {
        if (spec.action === 'replace' || spec.action === 'add' || spec.action === 'remove') {
            chunks = splitPromptIntoChunks(spec.text).map((text) => ({
                name: studioChangeChunkName(text),
                text,
                from: '',
                action: spec.action
            }));
        }
    }
    if (!chunks.length && spec.text && spec.action === 'replace') {
        chunks = [{
            name: 'Full text',
            text: spec.text,
            from: '',
            action: 'replace'
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

    STUDIO_CHANGE_PARAM_DEFS.forEach((def) => {
        if (!Object.prototype.hasOwnProperty.call(params, def.id)) return;
        const next = params[def.id];
        if (next === undefined) return;
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

    fieldSpecs.forEach(({ id, spec }) => {
        expandFieldChunks(id, spec).forEach((op) => ops.push(op));
    });

    const characters = Array.isArray(payload.characters) ? payload.characters : [];
    characters.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const action = (entry.action || (entry.index == null ? 'add' : 'replace')).toLowerCase();
        const charIndex = entry.index != null ? Number(entry.index) : (action === 'add' ? -1 : index);
        const name = entry.name || entry.chara_name || '';
        if (action === 'remove') {
            ops.push({
                key: `character:remove:${charIndex}:${index}`,
                group: 'Characters',
                kind: 'character',
                action: 'remove',
                charIndex,
                name: name || getStudioFieldLabel(`character:${charIndex}:prompt`),
                enabled: true
            });
            return;
        }
        if (action === 'add' || action === 'replace') {
            ops.push({
                key: `character:${action}:${charIndex}:${index}`,
                group: 'Characters',
                kind: 'character',
                action,
                charIndex,
                name: name || (action === 'add' ? 'New character' : `Character ${charIndex + 1}`),
                prompt: entry.prompt || '',
                uc: entry.uc || '',
                promptNegative: entry.promptNegative || entry.input_prompt_negative || '',
                enabled: true
            });
            ['prompt', 'uc', 'promptNegative'].forEach((part) => {
                const spec = entry[part] != null ? normalizeFieldSpec(entry[part]) : null;
                if (!spec) return;
                const fieldId = `character:${charIndex < 0 ? 'new' : charIndex}:${part}`;
                expandFieldChunks(fieldId, spec).forEach((op) => {
                    op.charIndex = charIndex;
                    op.pendingCharacter = action === 'add' && charIndex < 0;
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

    ops.filter((op) => op.enabled !== false).forEach((op) => {
        if (op.kind === 'param') {
            params[op.paramId] = op.toValue;
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
            if (!fieldMap.has(op.fieldId)) {
                fieldMap.set(op.fieldId, { id: op.fieldId, chunks: [] });
            }
            const field = fieldMap.get(op.fieldId);
            const chunk = { name: op.name, text: op.text, action: op.action };
            if (op.from) chunk.from = op.from;
            field.chunks.push(chunk);
            const actions = new Set(field.chunks.map((c) => c.action));
            field.action = actions.size === 1 ? [...actions][0] : 'add';
        }
    });

    if (Object.keys(params).length) payload.params = params;
    if (fieldMap.size) payload.fields = Array.from(fieldMap.values());
    if (characters.length) payload.characters = characters;
    return payload;
}

function buildExportOpsFromStudio() {
    const ops = [];
    const params = getStudioParamSnapshot();
    STUDIO_CHANGE_PARAM_DEFS.forEach((def) => {
        const value = params[def.id];
        if (value === undefined || value === null || value === '') return;
        ops.push({
            key: `param:${def.id}`,
            group: 'Parameters',
            kind: 'param',
            action: 'set',
            paramId: def.id,
            label: def.label,
            fromValue: value,
            toValue: value,
            enabled: false,
            unchanged: true
        });
    });

    const fieldIds = STUDIO_CHANGE_FIELD_DEFS.map((d) => d.id);
    getStudioCharacterItems().forEach((item, index) => {
        fieldIds.push(`character:${index}:prompt`, `character:${index}:uc`, `character:${index}:promptNegative`);
    });

    fieldIds.forEach((fieldId) => {
        const value = getStudioFieldValue(fieldId);
        if (!value || !String(value).trim()) return;
        const chunks = splitPromptIntoChunks(value);
        const source = chunks.length ? chunks : [value.trim()];
        source.forEach((text, index) => {
            ops.push({
                key: `field:${fieldId}:${index}:replace`,
                group: getStudioFieldLabel(fieldId),
                kind: 'chunk',
                action: 'replace',
                fieldId,
                name: studioChangeChunkName(text),
                text,
                from: '',
                enabled: true,
                found: true
            });
        });
    });

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

function wireStudioChangeDialog(dialog, ops, signal) {
    dialog.classList.add(STUDIO_CHANGE_DIALOG_CLASS);
    if (signal) {
        signal.addEventListener('abort', () => dialog.classList.remove(STUDIO_CHANGE_DIALOG_CLASS), { once: true });
    }
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
        case 'resolution':
            // selectManualResolution: public/scripts/comp/manualDropdownManager.js
            await selectManualResolution(String(value).toLowerCase());
            break;
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
    const hasCustomSize = enabled.some((op) => op.kind === 'param' && (op.paramId === 'width' || op.paramId === 'height'));
    const hasResolution = enabled.some((op) => op.kind === 'param' && op.paramId === 'resolution');
    if (hasCustomSize && !hasResolution) {
        await applyStudioParam('resolution', 'custom');
    }
    for (const op of enabled.filter((item) => item.kind === 'param')) {
        await applyStudioParam(op.paramId, op.toValue);
    }

    enabled.filter((op) => op.kind === 'character' && op.action === 'remove').sort((a, b) => b.charIndex - a.charIndex).forEach((op) => {
        const item = getStudioCharacterItems()[op.charIndex];
        if (item) {
            // deleteCharacterPrompt: public/scripts/comp/characterPromptManager.js
            deleteCharacterPrompt(item.id);
        }
    });

    const addedIndexes = [];
    enabled.filter((op) => op.kind === 'character' && op.action === 'add').forEach((op) => {
        const before = getStudioCharacterItems().length;
        addCharacterPrompt();
        const newIndex = before;
        addedIndexes.push(newIndex);
        if (op.name) setStudioCharacterName(newIndex, op.name);
        if (op.prompt) writeStudioFieldValue(`character:${newIndex}:prompt`, op.prompt);
        if (op.uc) writeStudioFieldValue(`character:${newIndex}:uc`, op.uc);
        if (op.promptNegative) writeStudioFieldValue(`character:${newIndex}:promptNegative`, op.promptNegative);
        op.createdIndex = newIndex;
    });

    enabled.filter((op) => op.kind === 'character' && op.action === 'replace').forEach((op) => {
        ensureStudioCharacterCount(op.charIndex + 1);
        if (op.name) setStudioCharacterName(op.charIndex, op.name);
        if (op.prompt) writeStudioFieldValue(`character:${op.charIndex}:prompt`, op.prompt);
        if (op.uc) writeStudioFieldValue(`character:${op.charIndex}:uc`, op.uc);
        if (op.promptNegative) writeStudioFieldValue(`character:${op.charIndex}:promptNegative`, op.promptNegative);
    });

    const newCharIndex = addedIndexes.length ? addedIndexes[addedIndexes.length - 1] : null;
    const chunkOps = enabled.filter((op) => op.kind === 'chunk').map((op) => {
        if (newCharIndex == null || !/^character:(new|-1):/.test(op.fieldId)) return op;
        return Object.assign({}, op, {
            fieldId: op.fieldId.replace(/^character:(new|-1):/, `character:${newCharIndex}:`)
        });
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
    const name = await showInputDialog(
        'Shortcut name',
        suggestedName || payload.title || 'Studio Change',
        'Enter shortcut name',
        [
            { text: 'Save', value: 'ok', className: 'btn-primary', icon: 'fas fa-floppy-disk', primary: true },
            { text: 'Cancel', value: null, className: 'btn-secondary' }
        ],
        null,
        { title: 'Save to Desktop', icon: 'fas fa-desktop' }
    );
    if (name == null) return false;
    const title = String(name).trim() || payload.title || 'Studio Change';
    payload.title = title;
    await desktopShortcuts.addShortcut({
        type: 'studio-change',
        name: title,
        data: { payload }
    });
    showGlassToast('success', 'Desktop', `Saved “${title}”`, false, 2500, '<i class="fas fa-desktop"></i>');
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
        { text: 'Save to Desktop', value: 'save', className: 'btn-secondary', icon: 'fas fa-desktop' },
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
            onDialogReady: (signal) => {
                const dialog = document.getElementById('confirmationDialog');
                if (dialog) wireStudioChangeDialog(dialog, ops, signal);
            },
            resolveValue: (value, dialog) => {
                dialog?.classList.remove(STUDIO_CHANGE_DIALOG_CLASS);
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
            hint: 'Uncheck anything you do not want applied. Prompt chunks can be included or skipped individually.',
            emptyMessage: 'This change JSON has nothing to apply.'
        });
        if (!result) return false;
        const enabledOps = result.ops.filter((op) => op.enabled !== false);
        if (!enabledOps.length) {
            showGlassToast('info', 'Studio change', 'Nothing selected', false, 2500, '<i class="fas fa-info-circle"></i>');
            return false;
        }
        const filtered = buildPayloadFromOps(enabledOps, payload.title);
        if (result.action === 'save') {
            await saveStudioChangeToDesktop(filtered, payload.title);
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
            hint: 'Choose parameters and prompt chunks to include. Unchecked prompt pieces are omitted from the JSON.',
            emptyMessage: 'Studio has nothing to export yet.',
            icon: 'fas fa-brackets-curly',
            buttons: [
                { text: 'Copy JSON', value: 'copy', className: 'btn-primary', icon: 'fa-regular fa-clipboard', primary: true },
                { text: 'Copy AI spec', value: 'spec', className: 'btn-secondary', icon: 'fas fa-robot' },
                { text: 'Save to Desktop', value: 'save', className: 'btn-secondary', icon: 'fas fa-desktop' },
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
        if (result.action === 'save') {
            if (!enabledOps.length) {
                showGlassToast('info', 'Studio change', 'Nothing selected', false, 2500, '<i class="fas fa-info-circle"></i>');
                return;
            }
            await saveStudioChangeToDesktop(payload, payload.title);
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

if (typeof window !== 'undefined') {
    window.tryApplyStudioChangeJsonFromText = tryApplyStudioChangeJsonFromText;
    window.openStudioChangeExportDialog = openStudioChangeExportDialog;
    window.handleStudioChangeShortcutClick = handleStudioChangeShortcutClick;
    window.STUDIO_CHANGE_AI_SPEC = STUDIO_CHANGE_AI_SPEC;
}
