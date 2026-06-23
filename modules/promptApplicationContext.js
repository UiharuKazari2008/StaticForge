/**
 * Builds client apply metadata (resolved baselines, expander/preset segment maps)
 * and maps server-processed prompt text back to raw editor values.
 */

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
}

function findAllPositions(text, searchText) {
    if (!text || !searchText) return [];
    const positions = [];
    let idx = 0;
    while (idx < text.length) {
        const found = text.indexOf(searchText, idx);
        if (found === -1) break;
        positions.push({ start: found, end: found + searchText.length });
        idx = found + Math.max(1, searchText.length);
    }
    return positions;
}

function buildExpanderSegments(resolvedText, seeds, sourceFilter) {
    const segments = [];
    if (!resolvedText || !Array.isArray(seeds)) return segments;

    const filtered = sourceFilter
        ? seeds.filter(s => s.source === sourceFilter)
        : seeds;

    for (const seed of filtered) {
        const value = seed.value;
        if (!value || typeof value !== 'string' || !value.trim()) continue;
        const pattern = seed.pattern || (seed.key ? `!${seed.key}` : null);
        if (!pattern) continue;

        for (const pos of findAllPositions(resolvedText, value)) {
            const overlaps = segments.some(s =>
                rangesOverlap(s.resolvedStart, s.resolvedEnd, pos.start, pos.end)
            );
            if (!overlaps) {
                segments.push({
                    pattern,
                    key: seed.key,
                    value,
                    source: seed.source,
                    type: seed.type,
                    resolvedStart: pos.start,
                    resolvedEnd: pos.end
                });
            }
        }
    }

    segments.sort((a, b) => a.resolvedStart - b.resolvedStart);
    return segments;
}

function buildPresetSegments(resolvedText, presetControls) {
    const segments = [];
    if (!resolvedText || !Array.isArray(presetControls)) return segments;

    for (const control of presetControls) {
        const text = control.text;
        if (!text || typeof text !== 'string' || !text.trim()) continue;
        for (const pos of findAllPositions(resolvedText, text)) {
            const overlaps = segments.some(s =>
                rangesOverlap(s.resolvedStart, s.resolvedEnd, pos.start, pos.end)
            );
            if (!overlaps) {
                segments.push({
                    type: control.action || 'preset',
                    text,
                    resolvedStart: pos.start,
                    resolvedEnd: pos.end,
                    bias: control.bias,
                    meta: control
                });
            }
        }
    }

    segments.sort((a, b) => a.resolvedStart - b.resolvedStart);
    return segments;
}

function buildStreamContext(raw, resolved, expanderSeeds, sourceKey, presetControls) {
    return {
        raw: raw || '',
        resolved: resolved || '',
        expander_segments: buildExpanderSegments(resolved, expanderSeeds, sourceKey),
        preset_segments: buildPresetSegments(resolved, presetControls)
    };
}

/**
 * @param {object} baseline - stashed during buildOptions before AI compile
 */
function buildPromptApplicationContext(baseline) {
    if (!baseline) {
        return {
            streams: {},
            text_replacements_seed: [],
            applied_preset_controls: { prompt: [], uc: [], character_prompts: [], character_uc: [] }
        };
    }

    const seeds = baseline.text_replacements_seed || [];
    const applied = baseline.appliedPresetControls || {
        prompt: [], uc: [], character_prompts: [], character_uc: []
    };

    const streams = {
        prompt: buildStreamContext(
            baseline.rawPrompt,
            baseline.promptForAI,
            seeds,
            'prompt',
            applied.prompt
        ),
        uc: buildStreamContext(
            baseline.rawNegativePrompt,
            baseline.ucForAI,
            seeds,
            'negative_prompt',
            applied.uc
        )
    };

    const rawChars = baseline.rawCharacterPrompts || [];
    const resolvedChars = baseline.characterPromptsForAI || [];
    streams.character_prompts = [];

    const charCount = Math.max(rawChars.length, resolvedChars.length);
    for (let i = 0; i < charCount; i++) {
        const rawChar = rawChars[i] || {};
        const resolvedChar = resolvedChars[i] || {};
        streams.character_prompts.push({
            prompt: buildStreamContext(
                rawChar.prompt || '',
                resolvedChar.prompt || '',
                seeds,
                `character_${i}_prompt`,
                applied.character_prompts
            ),
            uc: buildStreamContext(
                rawChar.uc || '',
                resolvedChar.uc || '',
                seeds,
                `character_${i}_uc`,
                applied.character_uc
            )
        });
    }

    return {
        streams,
        text_replacements_seed: seeds,
        applied_preset_controls: applied
    };
}

function replacePatternInRaw(raw, pattern, newValue) {
    if (!raw || !pattern) return raw;
    const escaped = escapeRegex(pattern);
    const regex = new RegExp(escaped, 'g');
    if (!regex.test(raw)) return raw;
    return raw.replace(new RegExp(escaped, 'g'), newValue);
}

/**
 * Map a single stream from resolved-after back to raw editor text.
 */
function mapStreamProcessedToRaw(streamCtx, resolvedBefore, resolvedAfter, presetToggleHints) {
    if (!streamCtx) return { raw: '', presetToggleHints };
    let raw = streamCtx.raw || '';

    if (resolvedBefore === resolvedAfter) {
        return { raw, presetToggleHints };
    }

    const expanderSegments = streamCtx.expander_segments || [];
    const presetSegments = streamCtx.preset_segments || [];

    // Expander regions: bake placeholder → new resolved substring
    for (const seg of expanderSegments) {
        const beforeSlice = resolvedBefore.substring(seg.resolvedStart, seg.resolvedEnd);
        const afterSlice = resolvedAfter.substring(seg.resolvedStart, Math.min(resolvedAfter.length, seg.resolvedEnd + (resolvedAfter.length - resolvedBefore.length)));
        if (beforeSlice !== afterSlice && afterSlice) {
            raw = replacePatternInRaw(raw, seg.pattern, afterSlice);
        }
    }

    // Preset regions touched by edits
    for (const seg of presetSegments) {
        const beforeSlice = resolvedBefore.substring(seg.resolvedStart, Math.min(seg.resolvedEnd, resolvedBefore.length));
        const endAfter = seg.resolvedEnd + (resolvedAfter.length - resolvedBefore.length);
        const afterSlice = resolvedAfter.substring(seg.resolvedStart, Math.min(endAfter, resolvedAfter.length));
        if (beforeSlice !== afterSlice) {
            const action = seg.type || seg.meta?.action;
            if (action === 'quality_preset') {
                presetToggleHints.append_quality = false;
                presetToggleHints.quality_baked_text = afterSlice;
            } else if (action === 'uc_preset') {
                presetToggleHints.append_uc_disabled = true;
                presetToggleHints.uc_baked_prefix = afterSlice;
            }
        }
    }

    // Literal fallback: if select exists in both resolved versions, patch raw when substring exists
    if (resolvedBefore !== resolvedAfter && raw === streamCtx.raw) {
        const minLen = Math.min(resolvedBefore.length, resolvedAfter.length);
        let diffStart = 0;
        while (diffStart < minLen && resolvedBefore[diffStart] === resolvedAfter[diffStart]) {
            diffStart++;
        }
        let diffEndBefore = resolvedBefore.length;
        let diffEndAfter = resolvedAfter.length;
        while (diffEndBefore > diffStart && diffEndAfter > diffStart &&
            resolvedBefore[diffEndBefore - 1] === resolvedAfter[diffEndAfter - 1]) {
            diffEndBefore--;
            diffEndAfter--;
        }
        const oldMid = resolvedBefore.substring(diffStart, diffEndBefore);
        const newMid = resolvedAfter.substring(diffStart, diffEndAfter);
        if (oldMid && raw.includes(oldMid)) {
            raw = raw.replace(oldMid, newMid);
        } else if (!oldMid && newMid) {
            raw = raw ? `${raw}, ${newMid}` : newMid;
        }
    }

    return { raw, presetToggleHints };
}

/**
 * Map full processed prompts (after Tendai) back to raw editor fields.
 */
function mapProcessedToRaw(applicationContext, resolvedBeforeStreams, resolvedAfterStreams) {
    const presetToggleHints = {};
    const result = {
        prompt: applicationContext?.streams?.prompt?.raw || '',
        uc: applicationContext?.streams?.uc?.raw || '',
        allCharacterPrompts: [],
        preset_toggle_hints: presetToggleHints
    };

    const promptMap = mapStreamProcessedToRaw(
        applicationContext?.streams?.prompt,
        resolvedBeforeStreams.prompt || '',
        resolvedAfterStreams.prompt || '',
        presetToggleHints
    );
    result.prompt = promptMap.raw;

    const ucMap = mapStreamProcessedToRaw(
        applicationContext?.streams?.uc,
        resolvedBeforeStreams.uc || '',
        resolvedAfterStreams.uc || '',
        presetToggleHints
    );
    result.uc = ucMap.raw;

    const charBefore = resolvedBeforeStreams.character_prompts || [];
    const charAfter = resolvedAfterStreams.character_prompts || [];
    const charCtx = applicationContext?.streams?.character_prompts || [];

    const charCount = Math.max(charBefore.length, charAfter.length, charCtx.length);
    for (let i = 0; i < charCount; i++) {
        const ctx = charCtx[i] || {};
        const before = charBefore[i] || {};
        const after = charAfter[i] || {};

        const promptRes = mapStreamProcessedToRaw(
            ctx.prompt,
            before.prompt || '',
            after.prompt || '',
            presetToggleHints
        );
        const ucRes = mapStreamProcessedToRaw(
            ctx.uc,
            before.uc || '',
            after.uc || '',
            presetToggleHints
        );

        result.allCharacterPrompts.push({
            prompt: promptRes.raw,
            uc: ucRes.raw
        });
    }

    result.preset_toggle_hints = presetToggleHints;
    return result;
}

module.exports = {
    buildPromptApplicationContext,
    buildExpanderSegments,
    buildPresetSegments,
    mapProcessedToRaw,
    mapStreamProcessedToRaw,
    replacePatternInRaw
};
