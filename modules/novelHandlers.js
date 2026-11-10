const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const customModelProviders = require('./customModelProviders');
const {
    normalizeNovelMetadata,
    MAX_NOVEL_UNDO_STACK
} = require('./notesDatabase');
const {
    countStoryLines,
    findIntentBlocks,
    applyResolvedIntentBlocks,
    generateNovelNoteName
} = require('./novelIntentBlocks');

// Novel Editor Generate / Refine on DeepInfra (Yozora #738; Yukimi Nov 10 2026: "we do not use
// grok anymore for anything"). DeepInfra is OpenAI-compatible chat completions with no
// server-side conversation state, so every call resends the whole story, the directive and the
// picture's generation prompt (the old xAI previous_response_id chain is gone). The reply is a
// JSON object (response_format json_object, the tokenRouterBridge.chatCompletion pattern; a
// model that refuses it gets the call again without it and the reply is parsed leniently).
// Provider: config novelProvider, else chatProvider, else 'deepinfra' (customModelProviders row
// and key). Model: config novelModel, else chatModel, else the provider row's defaultModel.
// Picture: no DeepInfra vision model is configured in this repo, so by default the picture is
// described by its generation prompt as text. Set config novelVisionModel (a vision model id,
// e.g. Qwen/Qwen3-VL-30B-A3B-Instruct) to send the picture itself to that model instead.
const NOVEL_MAX_TOKENS = 8000;
const NOVEL_TIMEOUT_MS = 300000;

const NOVEL_GENERATE_FORMAT = [
    '',
    'Output format (strict): reply with ONLY one JSON object, no markdown and no text outside it:',
    '{"append_text": string (new story prose to append after the existing content; expand any {user intent} blocks into vivid prose matching tone and style),',
    ' "resolved_blocks": [{"original": string, "resolved": string}] or null (the {intent} blocks you expanded),',
    ' "reason": string or null (one short sentence on what the continuation does)}'
].join('\n');

const NOVEL_REFINE_FORMAT = [
    '',
    'Output format (strict): reply with ONLY one JSON object, no markdown and no text outside it:',
    '{"refined_text": string (the refined replacement for the selected passage), "reason": string or null (one short sentence)}'
].join('\n');

function parseNovelReply(text) {
    let clean = String(text || '').trim();
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        const parsed = JSON.parse(clean);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* try the outer braces */ }
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(clean.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (_) { /* fall through */ }
    }
    return null;
}

function normalizeResolvedBlocks(value) {
    if (!Array.isArray(value)) return null;
    const blocks = value
        .filter((b) => b && typeof b.original === 'string' && typeof b.resolved === 'string')
        .map((b) => ({ original: b.original, resolved: b.resolved }));
    return blocks.length ? blocks : null;
}

class NovelHandlers {
    constructor(globalResources) {
        this.globalResources = globalResources;
    }

    getNotesDb() {
        return this.globalResources.getNotesDatabase();
    }

    readConfig(key) {
        try { return this.globalResources.getConfig({ path: key }); } catch (_) { return undefined; }
    }

    configText(key) {
        return String(this.readConfig(key) || '').trim();
    }

    getNovelProviderId() {
        return (this.configText('novelProvider') || this.configText('chatProvider') || 'deepinfra').toLowerCase();
    }

    // config novelModel, else chatModel, else the provider row's defaultModel, else the preset default.
    getNovelModel() {
        const configured = this.configText('novelModel') || this.configText('chatModel');
        if (configured) return configured;
        const row = customModelProviders.lookup(this.globalResources, this.getNovelProviderId());
        if (row && row.defaultModel) return row.defaultModel;
        const preset = customModelProviders.PRESETS.find((item) => item.id === 'deepinfra');
        return (preset && preset.defaultModel) || 'deepseek-ai/DeepSeek-V4.1-Flash';
    }

    // Empty unless configured: the picture is then sent as its generation prompt (text).
    getNovelVisionModel() {
        return this.configText('novelVisionModel');
    }

    // Generation prompt of a picture from the metadata DB, for when the client sent none.
    async compiledPromptsForImage(filename) {
        if (!filename) return '';
        try {
            const metadataDb = this.globalResources.getMetadataDatabase();
            if (!metadataDb || typeof metadataDb.getCachedMetadata !== 'function') return '';
            const row = await metadataDb.getCachedMetadata(filename);
            const meta = (row && row.metadata) || {};
            const forge = meta.forge_data || {};
            const dg = meta.dynamic_generation || forge.dynamic_generation || {};
            const compiled = dg.compiled_prompt || {};
            const chars = forge.allCharacters || meta.characterPrompts || compiled.character_prompts || [];
            return this.formatCompiledPrompts({
                input_prompt: forge.input_prompt || meta.prompt || meta.input_prompt || compiled.prompt || '',
                input_uc: forge.input_uc || meta.uc || meta.input_uc || compiled.uc || '',
                input_prompt_negative: forge.input_prompt_negative || meta.input_prompt_negative || '',
                character_prompts: Array.isArray(chars) ? chars.map((c) => (typeof c === 'string' ? { prompt: c } : c)) : []
            });
        } catch (_) {
            return '';
        }
    }

    // One JSON chat-completions call on the configured provider. Resolves { text, reasoning, id, model }.
    async callNovelModel(messages, model) {
        const provider = customModelProviders.requireReady(this.globalResources, this.getNovelProviderId());
        const body = {
            model,
            messages,
            max_tokens: NOVEL_MAX_TOKENS,
            stream: false,
            response_format: { type: 'json_object' }
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            const res = await fetch(provider.chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(NOVEL_TIMEOUT_MS)
            });
            customModelProviders.noteRateLimit(provider.id, res.headers);
            customModelProviders.noteKeyResult(provider.id, provider.apiKey, res.status);
            const text = await res.text();
            if (res.ok) {
                const json = JSON.parse(text);
                const message = (json.choices && json.choices[0] && json.choices[0].message) || {};
                return {
                    text: typeof message.content === 'string' ? message.content : '',
                    reasoning: message.reasoning_content || message.reasoning || '',
                    id: json.id || null,
                    model
                };
            }
            if (res.status === 400 && body.response_format && /response_format|json/i.test(text)) {
                delete body.response_format;
                continue;
            }
            const error = new Error(`${provider.name} novel request failed (HTTP ${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`);
            error.status = res.status;
            throw error;
        }
        throw new Error(`${provider.name} refused every novel request shape`);
    }

    publishProgress(wsServer, payload) {
        if (!wsServer || typeof wsServer.broadcast !== 'function') return;
        wsServer.broadcast({
            type: 'novel_progress',
            data: payload,
            timestamp: new Date().toISOString()
        });
    }

    async loadImageBuffer(filename) {
        if (!filename) return null;
        const imagesPath = this.globalResources.getPath('images');
        const filePath = path.join(imagesPath, filename);
        if (!fs.existsSync(filePath)) return null;
        const buffer = fs.readFileSync(filePath);
        const jpegBuffer = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
        return jpegBuffer;
    }

    async resolveLatestImageForNote(note) {
        const meta = normalizeNovelMetadata(note.metadata);

        if (meta.linked_images && meta.linked_images.length > 0) {
            const filename = meta.linked_images[0].filename;
            const buffer = await this.loadImageBuffer(filename);
            if (buffer) return { filename, buffer };
        }

        if (meta.undo_stack && meta.undo_stack.length > 0) {
            for (const snapshot of meta.undo_stack) {
                const undoFilename = snapshot?.generation_filename;
                if (!undoFilename) continue;
                const buffer = await this.loadImageBuffer(undoFilename);
                if (buffer) return { filename: undoFilename, buffer };
            }
        }

        const metadataDb = this.globalResources.getMetadataDatabase();
        if (metadataDb?.findLatestImageFilenameByNovelNoteId) {
            const dbFilename = await metadataDb.findLatestImageFilenameByNovelNoteId(note.id);
            if (dbFilename) {
                const buffer = await this.loadImageBuffer(dbFilename);
                if (buffer) return { filename: dbFilename, buffer };
            }
        }

        return { filename: null, buffer: null };
    }

    buildSettingsPrompt(settings = {}) {
        const s = settings || {};
        return [
            `Tone: ${s.tone || 'neutral'}`,
            `Style: ${s.style || 'literary'}`,
            `Explicitness: ${s.explicitness || 'moderate'}`,
            `Persuasiveness: ${s.persuasiveness || 'neutral'}`
        ].join('\n');
    }

    buildGenerateSystemPrompt(settings, mode = 'generate', pictureAsText = false) {
        const picture = pictureAsText
            ? '\n\nThe picture is given as the generation prompt it was drawn from (NovelAI tags); imagine the scene from it.'
            : '';
        const format = mode === 'refine' ? NOVEL_REFINE_FORMAT : NOVEL_GENERATE_FORMAT;
        return this.buildGenerateSystemPromptBody(settings) + picture + '\n' + format;
    }

    buildGenerateSystemPromptBody(settings) {
        return `You are a vivid literary novelist continuing an illustrated story.

Write rich, sensory prose that advances the narrative based on the generated image and prompts provided.

${this.buildSettingsPrompt(settings)}

Rules:
- ALWAYS advance the story forward with new events and detail
- Match the established voice and continuity of the story so far
- Expand any {user intent} blocks into full prose in the same style — the user placed these where they want something to happen but need help expressing it
- Output only new text to APPEND (do not repeat existing story)
- Keep paragraphs readable with natural line breaks
- Be vivid and detailed about what is happening in the scene`;
    }

    buildUserPrompt({ content, directive, compiledPrompts, mode, selection }) {
        let text = '';
        if (directive) {
            text += `## Creative Directive\n${directive}\n\n`;
        }
        if (compiledPrompts) {
            text += `## Image Generation Prompts Used\n${compiledPrompts}\n\n`;
        }
        if (content) {
            text += `## Story So Far\n${content}\n\n`;
        }
        const blocks = findIntentBlocks(content);
        if (blocks.length > 0) {
            text += `## User Intent Blocks to Expand\n`;
            blocks.forEach((b, i) => {
                text += `${i + 1}. ${b.full} — user wants: "${b.inner}"\n`;
            });
            text += '\n';
        }
        if (mode === 'refine' && selection) {
            text += `## Refine This Passage\nReplace or improve:\n${selection}\n\nProvide refined_text only for this passage.`;
        } else {
            text += `## Task\nWrite the next segment of the story that continues from the image and prompts above. Always move the plot forward.`;
        }
        return text;
    }

    formatCompiledPrompts(promptData = {}) {
        const parts = [];
        if (promptData.input_prompt) parts.push(`Prompt: ${promptData.input_prompt}`);
        if (promptData.input_uc) parts.push(`UC: ${promptData.input_uc}`);
        if (promptData.input_prompt_negative) parts.push(`Negative: ${promptData.input_prompt_negative}`);
        if (promptData.character_prompts && Array.isArray(promptData.character_prompts)) {
            promptData.character_prompts.forEach((c, i) => {
                if (c?.prompt) parts.push(`Character ${i + 1}: ${c.prompt}`);
            });
        }
        return parts.join('\n');
    }

    pushUndoSnapshot(metadata, snapshot) {
        const meta = normalizeNovelMetadata(metadata);
        meta.undo_stack = [snapshot, ...(meta.undo_stack || [])].slice(0, MAX_NOVEL_UNDO_STACK);
        return meta;
    }

    async runGenerate(ws, wsServer, message) {
        const {
            noteId,
            filename,
            directive,
            compiledPrompts,
            mode = 'generate',
            selection,
            resumeAdvancement = false
        } = message;

        const shouldAdvanceStory = resumeAdvancement === true || message.novel_resume_advancement === true;

        const notesDb = this.getNotesDb();
        const note = await notesDb.getNote(noteId);
        if (!note || note.note_kind !== 'novel') {
            throw new Error('Novel note not found');
        }

        const requestId = message.requestId || `novel-${Date.now()}`;
        this.publishProgress(wsServer, { phase: 'starting', noteId, requestId });

        let imageFilename = filename;
        let imageBuffer = null;
        if (filename) {
            imageBuffer = await this.loadImageBuffer(filename);
        }
        if (!imageBuffer) {
            const resolved = await this.resolveLatestImageForNote(note);
            imageFilename = resolved.filename;
            imageBuffer = resolved.buffer;
        }

        const metadata = normalizeNovelMetadata(note.metadata);
        const undoSnapshot = {
            content: note.content || '',
            last_response_id: metadata.last_response_id || null,
            story_cursor_line: metadata.story_cursor_line || 0,
            timestamp: Date.now(),
            generation_filename: imageFilename || null
        };
        metadata.undo_stack = this.pushUndoSnapshot(metadata, undoSnapshot).undo_stack;

        const settings = metadata.settings || {};
        const compiledText = typeof compiledPrompts === 'string'
            ? compiledPrompts
            : this.formatCompiledPrompts(compiledPrompts);

        const visionModel = imageBuffer ? this.getNovelVisionModel() : '';
        const model = visionModel || this.getNovelModel();
        const pictureAsText = !!imageFilename && !visionModel;
        let promptText = compiledText;
        if (!promptText && imageFilename) promptText = await this.compiledPromptsForImage(imageFilename);
        const userText = this.buildUserPrompt({
            content: note.content,
            directive: directive || metadata.directive_snapshot,
            compiledPrompts: promptText,
            mode,
            selection
        });
        const userMessage = visionModel
            ? {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } },
                    { type: 'text', text: userText }
                ]
            }
            : { role: 'user', content: userText };
        const messages = [
            { role: 'system', content: this.buildGenerateSystemPrompt(settings, mode, pictureAsText) },
            userMessage
        ];

        this.publishProgress(wsServer, { phase: 'streaming', noteId, requestId, reason: 'Writing story continuation...' });

        const result = await this.callNovelModel(messages, model);
        const parsed = parseNovelReply(result.text);
        let responseContent;
        if (parsed) {
            responseContent = parsed;
        } else if (mode === 'refine') {
            responseContent = { refined_text: String(result.text || '').trim() };
        } else {
            responseContent = { append_text: String(result.text || '').trim() };
        }
        responseContent.resolved_blocks = normalizeResolvedBlocks(responseContent.resolved_blocks);
        if (typeof responseContent.append_text !== 'string') responseContent.append_text = responseContent.append_text ? String(responseContent.append_text) : '';
        if (mode !== 'refine' && !responseContent.append_text.trim()) {
            throw new Error('The model returned no story text.');
        }
        if (mode === 'refine' && !String(responseContent.refined_text || '').trim()) {
            throw new Error('The model returned no refined text.');
        }

        let newContent = note.content || '';
        if (mode === 'refine' && responseContent.refined_text) {
            if (selection && newContent.includes(selection)) {
                newContent = newContent.replace(selection, responseContent.refined_text);
            } else {
                newContent = responseContent.refined_text;
            }
        } else {
            let appendText = responseContent.append_text || '';
            if (responseContent.resolved_blocks) {
                appendText = applyResolvedIntentBlocks(appendText, responseContent.resolved_blocks);
            }
            const fullContent = newContent + (newContent && appendText ? '\n\n' : '') + appendText;
            newContent = applyResolvedIntentBlocks(fullContent, responseContent.resolved_blocks);
        }

        if (directive) metadata.directive_snapshot = directive;
        // No server-side conversation state on DeepInfra: nothing to chain the next call to.
        metadata.last_response_id = null;
        if (shouldAdvanceStory) {
            metadata.story_cursor_line = countStoryLines(newContent);
        }
        if (imageFilename) {
            const linked = (metadata.linked_images || []).filter((e) => e.filename !== imageFilename);
            metadata.linked_images = [{ filename: imageFilename, date: Date.now() }, ...linked];
        }

        await notesDb.updateNote(noteId, { content: newContent, metadata });

        this.publishProgress(wsServer, {
            phase: 'completion',
            noteId,
            requestId,
            reason: responseContent.reason || 'Story updated'
        });

        return {
            success: true,
            note: await notesDb.getNote(noteId),
            append_text: responseContent.append_text,
            response_id: result.id,
            model: result.model
        };
    }

    async runUndo(noteId) {
        const notesDb = this.getNotesDb();
        const note = await notesDb.getNote(noteId);
        if (!note || note.note_kind !== 'novel') {
            throw new Error('Novel note not found');
        }
        const metadata = normalizeNovelMetadata(note.metadata);
        if (!metadata.undo_stack || metadata.undo_stack.length === 0) {
            throw new Error('Nothing to undo');
        }
        const [snapshot, ...rest] = metadata.undo_stack;
        metadata.undo_stack = rest;
        metadata.last_response_id = snapshot.last_response_id ?? null;
        metadata.story_cursor_line = snapshot.story_cursor_line ?? 0;
        await notesDb.updateNote(noteId, {
            content: snapshot.content || '',
            metadata
        });
        return { success: true, note: await notesDb.getNote(noteId) };
    }

    async listNovels(workspaceId) {
        return this.getNotesDb().getNovelNotesByWorkspace(workspaceId);
    }

    async resolveImage(noteId, preferredFilename = null) {
        const note = await this.getNotesDb().getNote(noteId);
        if (!note) throw new Error('Note not found');

        if (preferredFilename) {
            const buffer = await this.loadImageBuffer(preferredFilename);
            if (buffer) return { filename: preferredFilename, noteId };
        }

        const resolved = await this.resolveLatestImageForNote(note);
        return { filename: resolved.filename, noteId };
    }

    generateNoteName(options) {
        return generateNovelNoteName(options);
    }
}

module.exports = NovelHandlers;
