/**
 * Shared title tokenization for tag_words / tag_word_sequences indexing.
 * Used by scripts/create-tag-database.js and TagLookup backfill.
 */

const SPECIAL_TOKEN = '§';

function tokenizeTitleForIndex(title = '') {
    const lowerTitle = String(title || '').toLowerCase().trim();
    if (!lowerTitle) return [];

    const tokens = [];
    let currentToken = '';

    for (let i = 0; i < lowerTitle.length; i++) {
        const char = lowerTitle[i];
        const isSpecial = /[^a-z0-9\s]/.test(char);

        if (isSpecial) {
            if (currentToken.trim()) {
                tokens.push(currentToken.trim());
                currentToken = '';
            }
            tokens.push(SPECIAL_TOKEN);
        } else if (char === ' ') {
            if (currentToken.trim()) {
                tokens.push(currentToken.trim());
                currentToken = '';
            }
        } else {
            currentToken += char;
        }
    }
    if (currentToken.trim()) {
        tokens.push(currentToken.trim());
    }
    return tokens;
}

function extractWordsFromTokens(tokens) {
    const words = [];
    const seen = new Set();
    for (const token of tokens) {
        if (!token || token === SPECIAL_TOKEN) continue;
        if (!seen.has(token)) {
            seen.add(token);
            words.push(token);
        }
    }
    return words;
}

function buildWordSequencesFromTokens(tokens) {
    const sequences = [];
    if (!tokens || tokens.length === 0) return sequences;

    for (let startPos = 0; startPos < tokens.length; startPos++) {
        let sequence = '';
        let wordCount = 0;

        for (let endPos = startPos; endPos < tokens.length; endPos++) {
            const token = tokens[endPos];

            if (sequence) {
                if (token !== SPECIAL_TOKEN &&
                    sequence[sequence.length - 1] !== SPECIAL_TOKEN &&
                    sequence[sequence.length - 1] !== ' ') {
                    sequence += ' ';
                }
            }
            sequence += token;

            if (token !== SPECIAL_TOKEN) {
                wordCount++;
            }

            if (wordCount > 0) {
                const normalizedSequence = sequence.trim();
                if (normalizedSequence.length > 0) {
                    sequences.push({
                        sequence: normalizedSequence,
                        sequenceLength: wordCount,
                        startPosition: startPos
                    });
                }
            }
        }
    }
    return sequences;
}

function buildTitleSearchIndexData(title = '') {
    const tokens = tokenizeTitleForIndex(title);
    return {
        tokens,
        words: extractWordsFromTokens(tokens),
        sequences: buildWordSequencesFromTokens(tokens)
    };
}

module.exports = {
    SPECIAL_TOKEN,
    tokenizeTitleForIndex,
    extractWordsFromTokens,
    buildWordSequencesFromTokens,
    buildTitleSearchIndexData
};
