'use strict';

const MAX_KEYWORDS = 4;
const MAX_STEPS = 16;
const MAX_TEXT = 8000;

function sanitizeKeyword(raw, fallback) {
    let name = String(raw || '').trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!name) name = fallback || 'look';
    if (/^[0-9]/.test(name)) name = `k_${name}`;
    if (name.endsWith('_P') || name.endsWith('_N')) name = name.slice(0, -2) || (fallback || 'look');
    return name.slice(0, 32);
}

function clipText(value) {
    const text = typeof value === 'string' ? value : '';
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function stepName(value, index) {
    const text = String(value || '').trim();
    if (!text) return `Step ${index + 1}`;
    return text.slice(0, 48);
}

function variantFrom(raw) {
    if (typeof raw === 'string') {
        const text = clipText(raw);
        return { name: stepName(text, 0), prompt: text, uc: '' };
    }
    if (!raw || typeof raw !== 'object') {
        return { name: '', prompt: '', uc: '' };
    }
    const prompt = clipText(raw.prompt != null ? raw.prompt : raw.text);
    const nameSource = raw.name || raw.label || prompt;
    return {
        name: stepName(nameSource, 0),
        prompt,
        uc: clipText(raw.uc)
    };
}

function uniqueKeyword(name, used) {
    let next = name;
    let n = 2;
    while (used.has(next.toLowerCase())) {
        next = `${name}_${n}`.slice(0, 32);
        n += 1;
    }
    used.add(next.toLowerCase());
    return next;
}

function normalizeAxes(input) {
    const body = input && typeof input === 'object' ? input : {};
    const used = new Set();
    const rawAxes = Array.isArray(body.axes) ? body.axes : null;
    if (rawAxes && rawAxes.length) {
        return rawAxes.slice(0, MAX_KEYWORDS).map((axis, index) => {
            const variants = Array.isArray(axis && axis.variants) ? axis.variants : [];
            return {
                keyword: uniqueKeyword(sanitizeKeyword(axis && (axis.keyword || axis.name), `look_${index + 1}`), used),
                variants: variants.slice(0, MAX_STEPS).map(variantFrom)
            };
        }).filter((axis) => axis.variants.length);
    }
    const variants = Array.isArray(body.variants) ? body.variants : [];
    if (!variants.length) return [];
    return [{
        keyword: uniqueKeyword(sanitizeKeyword(body.keyword || body.name, 'look'), used),
        variants: variants.slice(0, MAX_STEPS).map(variantFrom)
    }];
}

function buildPhasewalkerState(input) {
    const axes = normalizeAxes(input);
    if (!axes.length) {
        const error = new Error('variants or axes are required');
        error.status = 400;
        throw error;
    }
    const stepCount = Math.max(...axes.map((axis) => axis.variants.length));
    if (stepCount < 2) {
        const error = new Error('Phasewalker needs at least two variants');
        error.status = 400;
        throw error;
    }
    const keywords = [];
    const keywordSteps = {};
    const stepNames = [];
    for (let i = 0; i < stepCount; i++) {
        const named = axes.map((axis) => axis.variants[i] && axis.variants[i].name).find((name) => name && !/^Step \d+$/.test(name));
        stepNames.push(named || `Step ${i + 1}`);
    }
    axes.forEach((axis) => {
        keywords.push(axis.keyword);
        keywordSteps[axis.keyword] = [];
        for (let i = 0; i < stepCount; i++) {
            const variant = axis.variants[i] || { prompt: '', uc: '' };
            keywordSteps[axis.keyword].push({
                id: `pw_${axis.keyword}_step_${i}`,
                prompt: variant.prompt || '',
                uc: variant.uc || ''
            });
        }
    });
    const useStage0 = !(input && input.useStage0 === false);
    return {
        keywords,
        keywordSteps,
        stepNames,
        useStage0,
        compareSourceStepIndex: null
    };
}

function phasewalkerPlaceholders(state) {
    const keywords = state && Array.isArray(state.keywords) ? state.keywords : [];
    const steps = state && state.keywordSteps ? state.keywordSteps : {};
    return keywords.map((keyword) => {
        const rows = steps[keyword] || [];
        const hasUc = rows.some((row) => row && String(row.uc || '').trim());
        return {
            keyword,
            prompt: `!${keyword}_P`,
            uc: hasUc ? `!${keyword}_N` : null
        };
    });
}

module.exports = {
    buildPhasewalkerState,
    phasewalkerPlaceholders
};
