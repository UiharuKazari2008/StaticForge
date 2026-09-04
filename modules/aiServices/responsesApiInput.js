'use strict';

/**
 * Chat Completions content parts → Responses API input parts.
 * Responses accepts input_text / input_image, not text / image_url.
 */

function toResponsesApiContentPart(part) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return part;
    if (part.type === 'text') {
        return { type: 'input_text', text: part.text };
    }
    if (part.type === 'image_url') {
        const raw = part.image_url;
        const url = typeof raw === 'string' ? raw : (raw && raw.url);
        return { type: 'input_image', image_url: url };
    }
    return part;
}

function toResponsesApiMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map((msg) => {
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return msg;
        if (!Array.isArray(msg.content)) return msg;
        return { ...msg, content: msg.content.map(toResponsesApiContentPart) };
    });
}

module.exports = {
    toResponsesApiContentPart,
    toResponsesApiMessages
};
