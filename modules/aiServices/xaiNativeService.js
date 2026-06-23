/**
 * XaiNativeService
 * Lightweight service for smaller/offline tasks using the native @ai-sdk/xai + Vercel AI SDK.
 * Intended for utility workloads (quips, quick research, small structured extractions, etc.).
 *
 * - Uses native xAI provider (not the raw openai SDK wrapper).
 * - Full streaming support via streamText.
 * - Native web search (and x_search) via xAI server-side tools when enabled.
 *   (Requires Responses model form under the hood for full native tool support.)
 * - Structured output via generateObject / streamText with Output.object.
 *
 * This service is intentionally separate from the main GrokService (which continues
 * to use the OpenAI SDK + Responses API for persona chats + heavy Director flows).
 */

const { xai, createXai } = require('@ai-sdk/xai');
const { streamText, generateText, generateObject, Output } = require('ai');

class XaiNativeService {
  constructor(globalResources) {
    if (!globalResources) {
      throw new Error('XaiNativeService requires globalResources instance');
    }
    this.globalResources = globalResources;
  }

  getDefaultModel() {
    return this.globalResources.getConfig({ path: 'defaultGrokModel' }) || 'grok-4.3';
  }

  /**
   * Resolve the current active Grok/xAI API key (respects apiKeyManager selection + env fallback).
   */
  getApiKey() {
    try {
      const mgr = this.globalResources.apiKeyManager;
      if (mgr && typeof mgr.getActiveApiKey === 'function') {
        const key = mgr.getActiveApiKey('grok');
        if (key) return key;
      }
    } catch (_) {}
    return process.env.GROK_API_KEY || null;
  }

  /**
   * Create an xAI model instance.
   * We must use createXai({ apiKey }) to create a provider *instance* that bakes in the
   * key (from apiKeyManager or env). Then call the provider with the model id.
   *
   * Passing apiKey in the second arg to the default `xai()` does not work for auth
   * because the key loading is closed over in createXai().
   *
   * Note: In the current @ai-sdk/xai version, there is no .responses() form exposed for
   * server-side tools like web_search / x_search. Those are available via the Responses
   * API (which the main GrokService uses via the openai SDK). For this native service,
   * web search can be added later with explicit tool definitions if needed.
   */
  createModel(modelId = null, { useResponsesForTools = false } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('No active Grok/xAI API key available (secure config or GROK_API_KEY).');
    }

    const chosenModel = modelId || this.getDefaultModel();

    if (useResponsesForTools) {
      console.warn('⚠️ useResponsesForTools requested but .responses() is not available in this version of @ai-sdk/xai; using standard chat model.');
    }

    const logger = this.globalResources.getLogger ? this.globalResources.getLogger() : null;
    if (logger && typeof logger.detailed === 'function') {
      // Masked so we don't leak keys in logs
      const masked = typeof apiKey === 'string' ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4) : 'present';
      logger.detailed(`[xai-native] creating model ${chosenModel} with key ${masked}`);
    }

    // Create a provider *instance* with the key baked in at creation time.
    // This is required for @ai-sdk/xai — the default xai(model, {apiKey}) does not
    // propagate the key into the auth headers (loadApiKey is closed over createXai options).
    const provider = createXai({ apiKey });
    return provider(chosenModel);
  }

  /**
   * Low-level access to a provider factory (advanced use).
   */
  getProvider() {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('No active Grok/xAI API key available');
    // createXai(options) returns a provider factory you can call as provider(modelId)
    return createXai({ apiKey });
  }

  /**
   * Generate plain text (non-streaming).
   * Useful for small one-shot utility calls.
   */
  async generateText(options = {}) {
    const {
      messages,
      prompt,
      system,
      model,
      temperature = 0.7,
      maxTokens = 4000,
      enableWebSearch = false,
      webSearchOptions = {},
      logLabel = 'AI (native)',
      reasoningEffort = 'low',
      ...rest
    } = options;

    const useResponses = !!enableWebSearch;
    const chosenModel = model || this.getDefaultModel();
    const aiModel = this.createModel(model, { useResponsesForTools: useResponses });

    const tools = {};
    if (enableWebSearch) {
      tools.web_search = xai.tools.webSearch({
        enableImageUnderstanding: true,
        ...webSearchOptions
      });
    }

    const msgCount = (messages && messages.length) || (prompt ? 1 : 0) || 1;
    const toolCount = Object.keys(tools).length;
    const logger = this.globalResources.getLogger ? this.globalResources.getLogger() : null;

    if (logger && typeof logger.detailed === 'function') {
      logger.detailed(`🎯 ${logLabel}: ${chosenModel} | ${msgCount} msgs | ${toolCount} tools${enableWebSearch ? ' | web_search' : ''}`);
    }

    if (logger && typeof logger.logGeneration === 'function') {
      const payloadMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : []);
      logger.logGeneration('AI_MESSAGES_SENT', {
        model: chosenModel,
        phase: 'quips',
        messageCount: msgCount,
        hasTools: toolCount > 0,
        source: 'xai-native',
        messages: payloadMessages.map((m, i) => ({
          index: i,
          role: m.role,
          fullContent: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      }, `xai-${Date.now()}`);
    }

    const result = await generateText({
      model: aiModel,
      messages: messages || undefined,
      prompt: prompt || undefined,
      system,
      temperature,
      maxTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      providerOptions: {
        xai: {
          reasoningEffort,
        },
      },
      ...rest
    });

    if (logger && typeof logger.logGeneration === 'function' && result?.usage) {
      const u = result.usage;
      const total = u.totalTokens || (u.promptTokens || 0) + (u.completionTokens || 0);
      logger.logGeneration('AI_API_USAGE', {
        phase: 'quips',
        model: chosenModel,
        total,
        input: u.promptTokens || u.inputTokens || 0,
        output: u.completionTokens || u.outputTokens || 0,
        source: 'xai-native'
      }, `xai-${Date.now()}`);
    }

    if (logger && typeof logger.detailed === 'function' && result?.usage) {
      const u = result.usage;
      const tot = u.totalTokens || (u.promptTokens||0)+(u.completionTokens||0);
      logger.detailed(`💾 [${logLabel}] Token usage: ${tot} total`);
    }

    return {
      text: result.text,
      sources: result.sources || [],
      usage: result.usage || null,
      toolCalls: result.toolCalls || [],
      finishReason: result.finishReason,
      raw: result
    };
  }

  /**
   * Streaming text generation.
   * Primary recommended entrypoint for "live" small tasks.
   *
   * Options:
   *   - messages / prompt / system (standard AI SDK shapes)
   *   - enableWebSearch: true → uses Responses model + native web_search tool
   *   - onChunk: (chunkText, accumulated) => void   // convenience callback
   *
   * Returns the final accumulated result + the raw AI SDK result for advanced use
   * (you can also consume result.textStream yourself if you pass no onChunk).
   */
  async streamText(options = {}) {
    const {
      messages,
      prompt,
      system,
      model,
      temperature = 0.7,
      maxTokens = 4000,
      enableWebSearch = false,
      webSearchOptions = {},
      onChunk,
      ...rest
    } = options;

    const useResponses = !!enableWebSearch;
    const aiModel = this.createModel(model, { useResponsesForTools: useResponses });

    const tools = {};
    if (enableWebSearch) {
      tools.web_search = xai.tools.webSearch({
        enableImageUnderstanding: true,
        ...webSearchOptions
      });
      // You can also add x_search here if desired:
      // tools.x_search = xai.tools.xSearch({ enableImageUnderstanding: true, ... });
    }

    const result = streamText({
      model: aiModel,
      messages: messages || undefined,
      prompt: prompt || undefined,
      system,
      temperature,
      maxTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      ...rest
    });

    let fullText = '';

    // If caller wants chunk callbacks, consume the stream here.
    if (typeof onChunk === 'function') {
      for await (const delta of result.textStream) {
        fullText += delta;
        try {
          onChunk(delta, fullText);
        } catch (cbErr) {
          // Don't let a bad callback kill the stream
          console.warn('xaiNativeService onChunk error:', cbErr?.message);
        }
      }
    }

    // Wait for the full result (this also resolves sources, usage, etc.)
    const final = await result;

    // If we didn't consume via onChunk, still collect the text
    if (!onChunk && final.text) {
      fullText = final.text;
    }

    return {
      text: final.text || fullText,
      sources: final.sources || [],
      usage: final.usage || null,
      toolCalls: final.toolCalls || [],
      finishReason: final.finishReason,
      raw: final,
      // Also expose the original stream result in case caller wants to do more with it
      streamResult: result
    };
  }

  /**
   * Structured object generation (non-streaming by default).
   * Excellent for small tasks that need reliable JSON (quips, classifications, extractions, etc.).
   *
   * When enableWebSearch is true we switch to the Responses model so the model can
   * use native web_search during reasoning if the prompt / schema benefits from it.
   */
  async generateObject(options = {}) {
    const {
      schema,
      messages,
      prompt,
      system,
      model,
      temperature = 0.7,
      maxTokens,
      enableWebSearch = false,
      webSearchOptions = {},
      logLabel = 'AI (native)',
      reasoningEffort = 'low',
      ...rest
    } = options;

    if (!schema) {
      throw new Error('generateObject requires a zod schema');
    }

    const useResponses = !!enableWebSearch;
    const chosenModel = model || this.getDefaultModel();
    const aiModel = this.createModel(model, { useResponsesForTools: useResponses });

    const tools = {};
    if (enableWebSearch) {
      tools.web_search = xai.tools.webSearch({
        enableImageUnderstanding: true,
        ...webSearchOptions
      });
    }

    const msgCount = (messages && messages.length) || (prompt ? 1 : 0) || 1;
    const toolCount = Object.keys(tools).length;
    const logger = this.globalResources.getLogger ? this.globalResources.getLogger() : null;

    if (logger && typeof logger.detailed === 'function') {
      logger.detailed(`🎯 ${logLabel}: ${chosenModel} | ${msgCount} msgs | ${toolCount} tools${enableWebSearch ? ' | web_search' : ''}`);
    }

    // Log full request payload to the generation log (reuses existing rich formatting for AI_ sections)
    if (logger && typeof logger.logGeneration === 'function') {
      const payloadMessages = messages || (prompt ? [{ role: 'user', content: prompt }] : []);
      logger.logGeneration('AI_MESSAGES_SENT', {
        model: chosenModel,
        phase: 'quips',
        messageCount: msgCount,
        hasTools: toolCount > 0,
        isStateful: false, // native path manages its own messages array for "session"
        source: 'xai-native',
        messages: payloadMessages.map((m, i) => ({
          index: i,
          role: m.role,
          fullContent: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        })),
        totalChars: JSON.stringify(payloadMessages).length
      }, `xai-${Date.now()}`);
    }

    const result = await generateObject({
      model: aiModel,
      schema,
      messages: messages || undefined,
      prompt: prompt || undefined,
      system,
      temperature,
      maxTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      mode: 'json', // Prefer JSON mode over tool-calling for more reliable structured output on xAI
      providerOptions: {
        xai: {
          reasoningEffort,
        },
      },
      ...rest
    });

    // Log usage in the same style as the main GrokService flows
    if (logger && typeof logger.logGeneration === 'function' && result?.usage) {
      const u = result.usage;
      const total = u.totalTokens || (u.promptTokens || 0) + (u.completionTokens || 0);
      logger.logGeneration('AI_API_USAGE', {
        phase: 'quips',
        model: chosenModel,
        total,
        input: u.promptTokens || u.inputTokens || 0,
        output: u.completionTokens || u.outputTokens || 0,
        source: 'xai-native'
      }, `xai-${Date.now()}`);
    }

    if (logger && typeof logger.detailed === 'function' && result?.usage) {
      const u = result.usage;
      const tot = u.totalTokens || (u.promptTokens||0)+(u.completionTokens||0);
      logger.detailed(`💾 [${logLabel}] Token usage: ${tot} total`);
    }

    return {
      object: result.object,
      usage: result.usage || null,
      sources: result.sources || [],
      finishReason: result.finishReason,
      raw: result
    };
  }

  /**
   * Streaming structured output (partial objects as they are built).
   * Uses streamText + Output.object under the hood.
   * Good when you want to show progressive structured results to a user.
   */
  async streamObject(options = {}) {
    const {
      schema,
      messages,
      prompt,
      system,
      model,
      temperature = 0.7,
      maxTokens,
      enableWebSearch = false,
      webSearchOptions = {},
      onPartial,
      ...rest
    } = options;

    if (!schema) {
      throw new Error('streamObject requires a zod schema');
    }

    const useResponses = !!enableWebSearch;
    const aiModel = this.createModel(model, { useResponsesForTools: useResponses });

    const tools = {};
    if (enableWebSearch) {
      tools.web_search = xai.tools.webSearch({
        enableImageUnderstanding: true,
        ...webSearchOptions
      });
    }

    const { partialOutputStream, ...streamResult } = streamText({
      model: aiModel,
      output: Output.object({ schema }),
      messages: messages || undefined,
      prompt: prompt || undefined,
      system,
      temperature,
      maxTokens,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      ...rest
    });

    const partials = [];
    if (typeof onPartial === 'function') {
      for await (const partial of partialOutputStream) {
        partials.push(partial);
        try {
          onPartial(partial, partials);
        } catch (cbErr) {
          console.warn('xaiNativeService onPartial error:', cbErr?.message);
        }
      }
    }

    // Resolve the final full result
    const final = await streamResult;

    return {
      finalObject: final.object || (partials.length ? partials[partials.length - 1] : null),
      partials,
      sources: final.sources || [],
      usage: final.usage || null,
      raw: final,
      streamResult
    };
  }

  /**
   * Convenience: run a small task with web search explicitly enabled.
   * (Mostly a documentation / discoverability helper.)
   */
  async generateWithWebSearch(options = {}) {
    return this.generateText({ ...options, enableWebSearch: true });
  }

  async streamWithWebSearch(options = {}) {
    return this.streamText({ ...options, enableWebSearch: true });
  }
}

module.exports = XaiNativeService;
