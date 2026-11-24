/**
 * Plaud MCP module (scope sfapp_plaud): Yukimi's Plaud recordings (brainstorming, UI reviews, live tests)
 * for Yozora (Xi), who turns them into Yozora issues for Claude Code or herself (Yukimi, Nov 23 2026:
 * "Only Yozora should have access to Plaud"). The account itself is added in CardSpace
 * (modules/plaudClient.js, ws/handlers/319-plaudHandler.js).
 *
 * Two gates, both required:
 *   - the application key carries sfapp_plaud by name ('universal' does not count);
 *   - the key is Xi's own (application name "Xi", modules/xiDirector.js ensureXiMcp).
 * Only the Xi key is widened to the scope (directorAppKeyScopes.js PLAUD_KEY_TARGETS); the Wren key
 * (Yumiya, Chiyo) and every other key never see these tools. Read-only: nothing here changes a recording.
 */

'use strict';

const SCOPE = 'sfapp_plaud';
const ROLE = 'plaud';
const OWNER_APP = 'xi';

const str = { type: 'string' };
const num = { type: 'number' };

function tool(name, description, properties, required) {
    return {
        name,
        core: true,
        role: ROLE,
        scope: SCOPE,
        description: `Plaud (Yukimi's recorder; Yozora only). ${description}`,
        inputSchema: { type: 'object', additionalProperties: false, required: required || [], properties: properties || {} }
    };
}

const TOOLS = [
    tool('plaud_list_recordings', 'List Yukimi\'s Plaud recordings, newest first: id, name, createdAt, startAt, durationMs. query matches the recording name (case-insensitive, over the 500 newest); from / to are YYYY-MM-DD (inclusive). Without query, page through with page.', {
        query: { type: 'string', description: 'Keyword in the recording name, e.g. "Review", "Brainstorm", "UI"' },
        from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        page: num,
        limit: { type: 'number', description: '10-100, default 20' }
    }),
    tool('plaud_get_recording', 'One recording: its details, Plaud\'s AI notes in Markdown (summary, action items, key topics), which transcript blocks it has, and source (plaud:<id>) to put in the issues you file so it is not planned twice.', {
        recordingId: str
    }, ['recordingId']),
    tool('plaud_get_transcript', 'The recording\'s transcript as "[mm:ss] Speaker: text" lines, 60,000 characters a call: call again with offset = nextOffset until nextOffset is null. block: transaction (default, as spoken), transaction_polish (AI-cleaned), outline, mark_memo (moments marked with the recorder\'s button).', {
        recordingId: str,
        block: { type: 'string', enum: ['transaction', 'transaction_polish', 'outline', 'mark_memo'] },
        offset: num
    }, ['recordingId'])
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

let backend = null;
const plaud = () => backend || require('./plaudClient');

function mcpTextResult(obj, isError) {
    return { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: isError === true };
}

function isPlaudTool(name) { return TOOL_NAMES.has(name); }

/** The key's scopes name sfapp_plaud itself ('universal' alone is not enough). */
function scopesHavePlaud(scopes) { return Array.isArray(scopes) && scopes.includes(SCOPE); }

function appNameOf(req) {
    try { return require('./agentClientBridge').resolveActorName(req); } catch (_) { return null; }
}

/** Is this caller Yozora's own key (application name "Xi")? */
function isPlaudOwner(appName) { return String(appName || '').trim().toLowerCase() === OWNER_APP; }

function requestScopes(req) {
    const auth = req && req.applicationAuth;
    if (auth && Array.isArray(auth.applicationScopes)) return auth.applicationScopes;
    try { return require('./agentClientBridge').resolveAgentAuthScopes(req); } catch (_) { return []; }
}

async function dispatch(name, input) {
    const p = plaud();
    if (name === 'plaud_list_recordings') return p.listRecordings({ query: input.query, from: input.from, to: input.to, page: input.page, limit: input.limit });
    if (name === 'plaud_get_recording') return p.getRecording(input.recordingId);
    if (name === 'plaud_get_transcript') return p.getTranscript(input.recordingId, { block: input.block, offset: input.offset });
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'UNKNOWN_TOOL' });
}

async function handlePlaudTool(req, name, args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const app = appNameOf(req);
    if (!isPlaudOwner(app)) {
        console.warn(`[plaud] ${name} refused for ${app || 'an unnamed key'}: Yozora only`);
        return mcpTextResult({ success: false, error: 'Plaud is for Yozora only', code: 'FORBIDDEN' }, true);
    }
    if (!scopesHavePlaud(requestScopes(req))) {
        return mcpTextResult({ success: false, error: `Application key does not have ${SCOPE}`, code: 'INSUFFICIENT_SCOPE' }, true);
    }
    try {
        const out = await dispatch(name, input);
        return mcpTextResult(Object.assign({ success: true }, out));
    } catch (error) {
        return mcpTextResult({ success: false, error: (error && error.message) || 'Failed', code: (error && error.code) || 'ERROR' }, true);
    }
}

module.exports = {
    SCOPE,
    ROLE,
    TOOLS,
    isPlaudTool,
    isPlaudOwner,
    scopesHavePlaud,
    handlePlaudTool,
    _test: { setBackend: (b) => { backend = b || null; } }
};
