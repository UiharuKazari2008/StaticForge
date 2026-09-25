/**
 * Map Studio allCharacterPrompts onto NovelAI parameters.characterPrompts.
 *
 * Client default labels are `Character ${index + 1}`
 * (public/scripts/comp/characterPromptManager.js). Those, plus blank/whitespace,
 * must omit the `name` key. Custom chara_name is sent as `name` only — never
 * folded into prompt / char_caption / base_caption.
 */

// Same shape the character box writes: "Character 1", "Character 2", …
const DEFAULT_CHARACTER_NAME_RE = /^character\s+\d+$/i;

function isDefaultCharacterPromptName(name) {
    if (name == null) return true;
    const trimmed = String(name).trim();
    if (!trimmed) return true;
    return DEFAULT_CHARACTER_NAME_RE.test(trimmed);
}

function resolveCharacterPromptApiName(char) {
    if (!char || typeof char !== 'object') return undefined;
    const raw = char.chara_name != null ? char.chara_name : char.name;
    if (raw == null) return undefined;
    const trimmed = String(raw).trim();
    if (!trimmed || isDefaultCharacterPromptName(trimmed)) return undefined;
    return trimmed;
}

function mapAllCharacterPromptsToApi(allCharacterPrompts, opts = {}) {
    if (!Array.isArray(allCharacterPrompts)) {
        return { characterPrompts: [], use_coords: false };
    }

    const processedCharacterPrompts = allCharacterPrompts.map(char => ({
        ...char,
        prompt: opts.auto_char_numerize === false ? char.prompt : char.prompt.replace(/1girl/g, 'girl').replace(/1boy/g, 'boy')
    }));

    // Same filter handleGeneration used: only truthy `enabled` goes to the API.
    // Empty-but-enabled slots stay so indices match v4_prompt.caption.char_captions.
    const enabledCharacters = processedCharacterPrompts.filter(char => char.enabled);

    const hasCustomCoords = enabledCharacters.some((char) => {
        const x = char.center?.x;
        const y = char.center?.y;
        if (typeof x !== 'number' || typeof y !== 'number') return false;
        return x !== 0.5 || y !== 0.5;
    });
    const useCoords = opts.use_coords === false ? false : hasCustomCoords;

    const characterPrompts = enabledCharacters.map(char => {
        let center = char.center;
        if (!useCoords || !center || typeof center.x !== 'number' || typeof center.y !== 'number') {
            center = { x: 0.5, y: 0.5 };
        }
        const entry = {
            prompt: char.prompt,
            uc: char.uc,
            center,
            enabled: char.enabled
        };
        const name = resolveCharacterPromptApiName(char);
        if (name !== undefined) entry.name = name;
        return entry;
    });

    return { characterPrompts, use_coords: useCoords };
}

module.exports = {
    DEFAULT_CHARACTER_NAME_RE,
    isDefaultCharacterPromptName,
    resolveCharacterPromptApiName,
    mapAllCharacterPromptsToApi
};
