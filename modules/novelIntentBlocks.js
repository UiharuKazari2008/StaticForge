const INTENT_BLOCK_REGEX = /\{([^{}]+)\}/g;

function splitStoryLines(content) {
    if (!content || typeof content !== 'string') return [];
    return content.split('\n');
}

function countStoryLines(content) {
    const lines = splitStoryLines(content);
    if (lines.length === 1 && lines[0] === '') return 0;
    return lines.length;
}

function getStorySegmentAfterCursor(content, cursorLine) {
    const lines = splitStoryLines(content);
    if (lines.length === 1 && lines[0] === '') return '';
    const cursor = Math.max(0, parseInt(cursorLine, 10) || 0);
    const segmentLines = lines.slice(cursor);
    return segmentLines.join('\n').trim();
}

function findIntentBlocks(text) {
    if (!text || typeof text !== 'string') return [];
    const blocks = [];
    let match;
    const regex = new RegExp(INTENT_BLOCK_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        blocks.push({
            full: match[0],
            inner: match[1].trim(),
            index: match.index
        });
    }
    return blocks;
}

function applyResolvedIntentBlocks(text, resolvedBlocks = []) {
    if (!text || !Array.isArray(resolvedBlocks) || resolvedBlocks.length === 0) return text;
    let result = text;
    for (const block of resolvedBlocks) {
        if (!block?.original || !block?.resolved) continue;
        result = result.split(block.original).join(block.resolved);
    }
    return result;
}

function generateNovelNoteName(options = {}) {
    const { directive, generatedImageName, content } = options;
    const truncate = (str, max = 48) => {
        const s = String(str || '').replace(/\s+/g, ' ').trim();
        if (!s) return '';
        return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    };

    if (directive && directive.trim()) return truncate(directive);
    if (generatedImageName && String(generatedImageName).trim()) return truncate(generatedImageName);
    if (content && content.trim()) {
        const firstLine = content.split('\n').find((l) => l.trim());
        if (firstLine) return truncate(firstLine);
    }
    const d = new Date();
    const dateSuffix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `Untitled Novel ${dateSuffix}`;
}

module.exports = {
    INTENT_BLOCK_REGEX,
    splitStoryLines,
    countStoryLines,
    getStorySegmentAfterCursor,
    findIntentBlocks,
    applyResolvedIntentBlocks,
    generateNovelNoteName
};
