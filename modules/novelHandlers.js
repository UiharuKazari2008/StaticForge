const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { z } = require('zod');
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

const NovelGenerateSchema = z.object({
    append_text: z.string().describe('New story prose to append after existing content. Expand any {user intent} blocks into vivid prose matching tone and style.'),
    resolved_blocks: z.array(z.object({
        original: z.string(),
        resolved: z.string()
    })).nullable().describe('Mappings for {intent} blocks that were expanded, or null if none'),
    reason: z.string().nullable().describe('Brief reasoning for the continuation, or null')
});

const NovelRefineSchema = z.object({
    refined_text: z.string().describe('Refined replacement text for the selected passage'),
    reason: z.string().nullable().describe('Brief reasoning, or null')
});

class NovelHandlers {
    constructor(globalResources) {
        this.globalResources = globalResources;
    }

    getNotesDb() {
        return this.globalResources.getNotesDatabase();
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

    buildGenerateSystemPrompt(settings) {
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

        const userText = this.buildUserPrompt({
            content: note.content,
            directive: directive || metadata.directive_snapshot,
            compiledPrompts: compiledText,
            mode,
            selection
        });

        const userContent = [];
        if (imageBuffer) {
            userContent.push({
                type: 'input_image',
                image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
            });
        }
        userContent.push({ type: 'input_text', text: userText });

        const messages = [
            {
                role: 'system',
                content: [{ type: 'input_text', text: this.buildGenerateSystemPrompt(settings) }]
            },
            { role: 'user', content: userContent }
        ];

        const grokService = this.globalResources.getGrokService();
        const schema = mode === 'refine' ? NovelRefineSchema : NovelGenerateSchema;
        const aiOptions = {
            model: grokService.getDefaultGrokModel(),
            timeout: 300000,
            store: true,
            responseSchema: schema,
            toolLoops: 1,
            extractKeys: ['reason', 'append_text'],
            ws,
            handler: { sendGenerationProgress: (_, reqId, data) => this.publishProgress(wsServer, { ...data, noteId, requestId: reqId || requestId }) },
            requestId
        };
        if (metadata.last_response_id) {
            aiOptions.previous_response_id = metadata.last_response_id;
        }

        this.publishProgress(wsServer, { phase: 'streaming', noteId, requestId, reason: 'Writing story continuation…' });

        const grokResponse = await grokService.callDirectorAIWithStructuredOutput(messages, aiOptions);
        let responseContent = grokResponse.content || grokResponse.message || grokResponse;
        if (typeof responseContent === 'string') {
            try {
                responseContent = JSON.parse(responseContent);
            } catch {
                responseContent = { append_text: responseContent };
            }
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
        metadata.last_response_id = grokResponse.responseId || grokResponse.id || metadata.last_response_id;
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
            response_id: grokResponse.responseId
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
