'use strict';

// Chat personas on DeepInfra (Yozora #736; Yukimi Nov 10 2026: "we do not use grok anymore").
// DeepInfra is an OpenAI-compatible chat-completions host with no server-side conversation
// state, so every turn rebuilds the history from chat.db (the last HISTORY_ROWS rows): user
// rows become user messages, assistant event rows of one reply become one assistant message
// holding that reply's JSON event array. The provider row and key come from
// customModelProviders (config.json row + secure.config.json customModelProviders.keys[]).
// Model: config `chatModel`, else that provider row's defaultModel (the Director engines'
// default), else the preset default. Provider: config `chatProvider`, default 'deepinfra'.
// Images are not sent by default (the default model is text only; the persona prompt carries
// the image's generation tags). Set config `chatSendImages: true` with a vision model to send
// the character picture and the viewer avatar as image_url parts.
// Streaming: complete event objects are pulled out of the JSON as it arrives (clarinet) and
// handed to onStreamUpdate(null, fullResponse, [event]), the same shape the old Grok path used.

const clarinet = require('clarinet');
const sharp = require('sharp');
const customModelProviders = require('../customModelProviders');

const EVENT_TYPES = new Set([
    'actions', 'sfx', 'speechdirect', 'speech', 'reply', 'innerspeech',
    'emotion', 'environment', 'memory', 'currplan', 'futureplans',
    'trustlevel', 'inventory', 'sensory', 'offlinemessage',
    'timeofday', 'location', 'myname'
]);
const HISTORY_ROWS = 160;
const MAX_TOKENS = 8000;
const REQUEST_TIMEOUT_MS = 180000;

const FORMAT_REMINDER = [
    '',
    '**Output format (strict):** reply with ONLY a JSON array of event objects, no markdown and no text outside the array.',
    `Each event is {"type": one of ${[...EVENT_TYPES].join(', ')}, "content": string, "timestamp": number}; memory events may add "weight" (0-100), emotion events may add "intensity" (0-100).`
].join('\n');

function finiteOrUndefined(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Lenient parse: strips code fences, accepts an array or { events: [...] }, keeps valid events.
function parseEvents(text) {
    let clean = String(text || '').trim();
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed = null;
    try {
        parsed = JSON.parse(clean);
    } catch (_) {
        const start = clean.indexOf('[');
        const end = clean.lastIndexOf(']');
        if (start >= 0 && end > start) {
            try { parsed = JSON.parse(clean.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1')); } catch (_) { parsed = null; }
        }
    }
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.events) ? parsed.events : null);
    if (!list) return null;
    const events = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item.type || '').trim();
        if (!EVENT_TYPES.has(type) || typeof item.content !== 'string') continue;
        events.push({
            type,
            content: item.content,
            timestamp: finiteOrUndefined(item.timestamp),
            weight: finiteOrUndefined(item.weight),
            intensity: finiteOrUndefined(item.intensity)
        });
    }
    return events;
}

function ensureUniqueTimestamps(events) {
    const used = new Set();
    let max = -1;
    for (const event of events) {
        if (event.timestamp !== undefined && event.timestamp > max) max = event.timestamp;
    }
    for (const event of events) {
        if (event.timestamp === undefined || used.has(event.timestamp)) {
            max += 1;
            event.timestamp = max;
        }
        used.add(event.timestamp);
    }
    return events;
}

function simplifyUsage(usage) {
    if (!usage) return null;
    const prompt = usage.prompt_tokens_details || null;
    const completion = usage.completion_tokens_details || null;
    return {
        total: usage.total_tokens || 0,
        input: usage.prompt_tokens || 0,
        output: usage.completion_tokens || 0,
        cache: (prompt && prompt.cached_tokens) || 0,
        reasoning: (completion && completion.reasoning_tokens) || 0
    };
}

// Streams complete event objects (objects whose parent is an array) out of partial JSON.
function createEventExtractor(onEvent) {
    const parser = clarinet.parser();
    const stack = []; // 'array' | 'object'
    let current = null;
    let key = null;
    const closeValue = () => { key = null; };
    parser.onopenarray = () => { stack.push('array'); };
    parser.onclosearray = () => { stack.pop(); };
    parser.onopenobject = (firstKey) => {
        const parent = stack[stack.length - 1];
        stack.push('object');
        if (parent === 'array' && !current) {
            current = { depth: stack.length, event: {} };
        }
        key = firstKey;
    };
    parser.onkey = (next) => { key = next; };
    parser.onvalue = (value) => {
        if (current && stack.length === current.depth && key) current.event[key] = value;
        closeValue();
    };
    parser.oncloseobject = () => {
        if (current && stack.length === current.depth) {
            const event = current.event;
            current = null;
            if (EVENT_TYPES.has(event.type) && typeof event.content === 'string') onEvent(event);
        }
        stack.pop();
    };
    parser.onerror = () => {
        // Partial or malformed JSON mid-stream: stop live extraction; the final parse decides.
        parser.onerror = () => {};
        failed = true;
    };
    let failed = false;
    return {
        write(text) {
            if (failed || !text) return;
            try { parser.write(text); } catch (_) { failed = true; }
        },
        end() {
            if (failed) return;
            try { parser.close(); } catch (_) { /* final parse decides */ }
        }
    };
}

class DeepInfraChatService {
    constructor(globalResources) {
        if (!globalResources) throw new Error('DeepInfraChatService requires globalResources');
        this.globalResources = globalResources;
    }

    readConfig(key) {
        try { return this.globalResources.getConfig({ path: key }); } catch (_) { return undefined; }
    }

    getProviderId() {
        const id = String(this.readConfig('chatProvider') || 'deepinfra').trim().toLowerCase();
        return id || 'deepinfra';
    }

    getProvider() {
        return customModelProviders.requireReady(this.globalResources, this.getProviderId());
    }

    // config chatModel, else the provider row's defaultModel, else the DeepInfra preset default.
    getDefaultModel() {
        const configured = String(this.readConfig('chatModel') || '').trim();
        if (configured) return configured;
        const row = customModelProviders.lookup(this.globalResources, this.getProviderId());
        if (row && row.defaultModel) return row.defaultModel;
        const preset = customModelProviders.PRESETS.find((item) => item.id === 'deepinfra');
        return (preset && preset.defaultModel) || 'deepseek-ai/DeepSeek-V4.1-Flash';
    }

    // Old Grok sessions keep their row; their grok-* model id never reaches DeepInfra.
    modelForSession(sessionData) {
        const wanted = String((sessionData && sessionData.model) || '').trim();
        if (sessionData && sessionData.provider === this.getProviderId() && wanted && !/^grok/i.test(wanted)) return wanted;
        return this.getDefaultModel();
    }

    sendImages() {
        return this.readConfig('chatSendImages') === true;
    }

    async createPersonaChatSession(sessionData, personaSettings, systemPrompt) {
        const characterMemories = await this.globalResources.getMemoryManager().getCharacterMemories(sessionData.id);
        const formattedMemories = characterMemories
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 20)
            .map((m) => `[${m.weight}%] ${m.content}`)
            .join(', ');
        const enhanced = String(systemPrompt || '')
            .replace('{{character_memories}}', characterMemories.length > 0 ? `- **Your Core Memories (weighted by importance):** ${formattedMemories}` : '')
            .replace('{{conversation_history}}', '');
        return {
            chatId: sessionData.id,
            model: this.modelForSession(sessionData),
            systemPrompt: enhanced + '\n' + FORMAT_REMINDER,
            sessionData,
            personaSettings
        };
    }

    async compressImage(base64String, mimeType, maxDimension = 1024, quality = 85) {
        try {
            const buffer = Buffer.from(base64String, 'base64');
            const out = await sharp(buffer)
                .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality })
                .toBuffer();
            return { base64: out.toString('base64'), mimeType: 'image/jpeg' };
        } catch (_) {
            return { base64: base64String, mimeType };
        }
    }

    // chat.db rows -> chat messages. Assistant rows of one reply share a response_id.
    async loadHistory(chatId) {
        const rows = await this.globalResources.getChatDatabase().getChatMessages(chatId, HISTORY_ROWS, 0);
        rows.sort((a, b) => (a.id || 0) - (b.id || 0));
        const messages = [];
        let pending = null; // { key, events: [] }
        const flush = () => {
            if (pending && pending.events.length) {
                messages.push({ role: 'assistant', content: JSON.stringify(pending.events) });
            }
            pending = null;
        };
        for (const row of rows) {
            if (row.message_type === 'user') {
                flush();
                if (row.content) messages.push({ role: 'user', content: String(row.content) });
                continue;
            }
            if (row.message_type !== 'assistant' || !row.event_type) continue; // skip "Error: ..." rows
            const key = row.response_id || `row-${row.id}`;
            if (!pending || pending.key !== key) {
                flush();
                pending = { key, events: [] };
            }
            pending.events.push({ type: row.event_type, content: String(row.content || '') });
        }
        flush();
        return messages;
    }

    async personaUserMessage(personaImage, userPrompt, viewerAvatar) {
        const personaPrompt = this.globalResources.getPromptManager().getPersonaEstablishmentPrompt('characterChat', userPrompt);
        if (!this.sendImages() || !personaImage) {
            const note = personaImage
                ? `\n\n(The image of your form is given here as the tags it was drawn from: ${userPrompt})`
                : '';
            return { role: 'user', content: personaPrompt + note };
        }
        const persona = await this.compressImage(personaImage.base64, personaImage.mimeType);
        const content = [
            { type: 'text', text: personaPrompt },
            { type: 'image_url', image_url: { url: `data:${persona.mimeType};base64,${persona.base64}` } }
        ];
        if (viewerAvatar) {
            const avatar = await this.compressImage(viewerAvatar.base64, viewerAvatar.mimeType);
            content.push({ type: 'text', text: '\n\nThis is my beloved, who I am speaking to:' });
            content.push({ type: 'image_url', image_url: { url: `data:${avatar.mimeType};base64,${avatar.base64}` } });
        }
        return { role: 'user', content };
    }

    // One chat-completions call (streamed when onStreamUpdate is set).
    async complete(chat, messages, onStreamUpdate) {
        const provider = this.getProvider();
        const stream = typeof onStreamUpdate === 'function';
        const body = {
            model: chat.model || this.getDefaultModel(),
            messages,
            max_tokens: MAX_TOKENS,
            stream
        };
        if (stream) body.stream_options = { include_usage: true };
        const res = await fetch(provider.chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        customModelProviders.noteRateLimit(provider.id, res.headers);
        customModelProviders.noteKeyResult(provider.id, provider.apiKey, res.status);
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 300); } catch (_) { /* none */ }
            const error = new Error(`${provider.name} chat request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
            error.status = res.status;
            throw error;
        }
        if (!stream) {
            const json = await res.json();
            const text = json && json.choices && json.choices[0] && json.choices[0].message ? String(json.choices[0].message.content || '') : '';
            return { text, id: json && json.id, usage: json && json.usage };
        }

        let fullResponse = '';
        let id = null;
        let usage = null;
        const extractor = createEventExtractor((event) => {
            try { onStreamUpdate(null, fullResponse, [event]); } catch (_) { /* client gone */ }
        });
        const decoder = new TextDecoder();
        let buffer = '';
        const handleLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') return;
            let chunk;
            try { chunk = JSON.parse(data); } catch (_) { return; }
            if (chunk.id && !id) id = chunk.id;
            if (chunk.usage) usage = chunk.usage;
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
            const piece = delta && typeof delta.content === 'string' ? delta.content : '';
            if (piece) {
                fullResponse += piece;
                extractor.write(piece);
            }
        };
        for await (const part of res.body) {
            buffer += decoder.decode(part, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                handleLine(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
            }
        }
        if (buffer) handleLine(buffer);
        extractor.end();
        return { text: fullResponse, id, usage };
    }

    // Parse, store each event as a chat row, update name/memories/usage. Returns { content, usage }.
    async storeReply(chat, result) {
        const events = parseEvents(result.text);
        if (!events || events.length === 0) {
            throw new Error('The persona reply was not a JSON event list.');
        }
        ensureUniqueTimestamps(events);
        const chatDb = this.globalResources.getChatDatabase();
        const responseId = result.id || `deepinfra-${Date.now()}`;
        for (const event of events) {
            const metadata = {};
            if (event.timestamp !== undefined) metadata.timestamp = event.timestamp;
            if (event.weight !== undefined) metadata.weight = event.weight;
            if (event.intensity !== undefined) metadata.intensity = event.intensity;
            await chatDb.addChatMessage(
                chat.chatId, 'assistant', event.content, null, responseId, null, null, event.type,
                Object.keys(metadata).length ? JSON.stringify(metadata) : null, null, null
            );
        }
        const myname = events.find((event) => event.type === 'myname' && event.content.trim());
        if (myname) {
            const name = myname.content.trim();
            await chatDb.updateChatSession(chat.chatId, { chat_name: name, character_name: name });
        }
        const memoryManager = this.globalResources.getMemoryManager();
        const memories = memoryManager.extractMemoriesFromResponse(JSON.stringify(events));
        for (const memory of memories) {
            await memoryManager.addCharacterMemory(chat.chatId, memory);
        }
        const updates = { provider: this.getProviderId(), model: chat.model };
        if (result.usage) {
            updates.total_tokens = result.usage.total_tokens || 0;
            updates.last_response_usage = JSON.stringify(result.usage);
        }
        await chatDb.updateChatSession(chat.chatId, updates);
        const content = JSON.stringify(events.map((event) => {
            const out = { type: event.type, content: event.content, timestamp: event.timestamp };
            if (event.weight !== undefined) out.weight = event.weight;
            if (event.intensity !== undefined) out.intensity = event.intensity;
            return out;
        }));
        return { content, usage: simplifyUsage(result.usage) };
    }

    async establishPersona(chat, personaImage, userPrompt, viewerAvatar, onStreamUpdate = null) {
        const messages = [
            { role: 'system', content: chat.systemPrompt },
            await this.personaUserMessage(personaImage, userPrompt, viewerAvatar)
        ];
        const result = await this.complete(chat, messages, onStreamUpdate);
        return this.storeReply(chat, result);
    }

    establishPersonaStreaming(chat, personaImage, userPrompt, viewerAvatar, onStreamUpdate) {
        return this.establishPersona(chat, personaImage, userPrompt, viewerAvatar, onStreamUpdate);
    }

    // The user message is already stored by the caller (AIServiceManager.continueConversation),
    // so the history ends with it; a message that is not the last row is appended.
    async continueConversation(chat, message, onStreamUpdate = null) {
        const history = await this.loadHistory(chat.chatId);
        const last = history[history.length - 1];
        if (!last || last.role !== 'user' || last.content !== message) {
            history.push({ role: 'user', content: String(message) });
        }
        const messages = [{ role: 'system', content: chat.systemPrompt }, ...history];
        const result = await this.complete(chat, messages, onStreamUpdate);
        return this.storeReply(chat, result);
    }

    continueConversationStreaming(chat, message, onStreamUpdate) {
        return this.continueConversation(chat, message, onStreamUpdate);
    }
}

DeepInfraChatService._test = { parseEvents, ensureUniqueTimestamps, createEventExtractor, simplifyUsage };

module.exports = DeepInfraChatService;
