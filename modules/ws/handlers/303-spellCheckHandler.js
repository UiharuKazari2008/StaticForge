const wsPacketRegistry = require('../wsPacketRegistry');

// Spell Check for text a person writes (Melaton Mobile Messaging and Text Messages, Yozora #757):
// the words the spell engine (modules/spellChecker.js over spellEngine.js) does not know, in order,
// each with its place in the text and its suggestions. Signed-in clients only.

const MAX_TEXT = 20000;

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[303-spellCheckHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('spell_check_text', async ({ ws, message, clientInfo }) => {
        const reply = (data) => handlersCtx.sendToClient(ws, { type: 'spell_check_text_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        if (!clientInfo || !clientInfo.authenticated) {
            reply({ success: false, code: 'NOT_SIGNED_IN', error: 'Sign in first' });
            return;
        }
        const body = message.data && typeof message.data === 'object' ? message.data : message;
        const text = String(body.text || '').slice(0, MAX_TEXT);
        let checker = null;
        try {
            const gr = handlersCtx.globalResources;
            checker = gr && typeof gr.getSpellChecker === 'function' ? gr.getSpellChecker() : null;
        } catch (_) { checker = null; }
        if (!checker || typeof checker.checkText !== 'function') {
            reply({ success: false, code: 'UNAVAILABLE', error: 'Spell check is not available right now.' });
            return;
        }
        try {
            const r = checker.checkText(text);
            const words = (r.wordPositions || [])
                .filter((w) => r.suggestions && Object.prototype.hasOwnProperty.call(r.suggestions, w.word))
                .map((w) => ({ word: w.word, start: w.start, end: w.end, suggestions: (r.suggestions[w.word] || []).slice(0, 5) }));
            reply({ success: true, words });
        } catch (error) {
            reply({ success: false, code: 'ERROR', error: error.message });
        }
    }, { owner: 'spellCheck' });
}

module.exports = { registerPackets };
