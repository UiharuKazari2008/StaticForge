// Token Analysis tool window (#tokenDisplayModal, markup in app.html, css/vista-studio-tools.css).
// Opened from a prompt box's token count (.token-info-container in its toolbar). Shows the field's
// text as the model's tokenizer splits it: one tinted box per token in a read-only box, the selected
// token's properties under it. Follows the field while the window is open (re-analysed on input).

// tokenInfoClickHandlersWired: public/scripts/comp/emphasisSyntaxToggles.js

const TOKEN_ANALYSIS_REFRESH_MS = 200;
let tokenAnalysisTextarea = null;
let tokenAnalysisTokens = [];
let tokenAnalysisSelected = -1;
let tokenAnalysisRefreshTimer = 0;
let tokenAnalysisTokenizerLabel = '';

function initializeTokenInfoClickHandlers() {
    if (tokenInfoClickHandlersWired) {
        return;
    }
    tokenInfoClickHandlersWired = true;

    document.addEventListener('click', (e) => {
        const tokenInfo = e.target.closest('.token-info-container');
        if (!tokenInfo) return;
        const toolbar = tokenInfo.closest('.prompt-textarea-toolbar');
        const container = toolbar && toolbar.parentElement;
        if (!container) return;

        // the UC tab has two fields; prefer the one that was focused
        let textarea = null;
        if (window.promptTextareaToolbar && window.promptTextareaToolbar.activeTextarea &&
            container.contains(window.promptTextareaToolbar.activeTextarea)) {
            textarea = window.promptTextareaToolbar.activeTextarea;
        }
        if (!textarea) {
            textarea = container.querySelector('textarea.prompt-textarea, textarea.character-prompt-textarea') ||
                container.querySelector('#manualPrompt, #manualUc, #manualPromptNegative');
        }
        if (textarea) {
            void openTokenDisplayModal(textarea);
        }
    });
}

// escapeHtml: public/scripts/comp/utilities.js

/** The field's name as the Studio labels it (base prompt, Undesired Content, Character N ...). */
function describeTokenAnalysisField(textarea) {
    const id = textarea && textarea.id || '';
    if (id === 'manualPrompt') return { name: 'Prompt', group: 'prompt' };
    if (id === 'manualUc') return { name: 'Undesired Content', group: 'uc' };
    if (id === 'manualPromptNegative') return { name: 'Negative Prompt', group: 'prompt' };
    if (textarea && textarea.classList.contains('character-prompt-textarea')) {
        const all = Array.from(document.querySelectorAll('.character-prompt-textarea[id$="_prompt"]'));
        const base = id.replace(/_(prompt|uc|promptNegative)$/, '_prompt');
        const index = all.findIndex((el) => el.id === base);
        const who = index >= 0 ? `Character ${index + 1}` : 'Character';
        if (/_uc$/.test(id)) return { name: `${who} Undesired Content`, group: 'uc' };
        if (/_promptNegative$/.test(id)) return { name: `${who} Negative Prompt`, group: 'prompt' };
        return { name: `${who} Prompt`, group: 'prompt' };
    }
    return { name: 'Prompt', group: 'prompt' };
}

/** The text the token bar counts: stage blocks and managed emphasis delimiters stripped. */
function getTokenAnalysisText(rawText) {
    // stripTextForTokenCount: public/scripts/comp/promptTextareaToolbar.js
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar
        && typeof promptTextareaToolbar.stripTextForTokenCount === 'function') {
        return promptTextareaToolbar.stripTextForTokenCount(rawText || '');
    }
    // stripPromptBlocksForEffectivePrompt: public/scripts/comp/promptStageBlocks.js
    // stripManagedEmphasisDelimitersForCounting: public/scripts/comp/emphasisGroupIdCodec.js
    const text = stripPromptBlocksForEffectivePrompt(rawText || '', {
        stageIndex: 0,
        pipelineStageGeneration: false
    });
    return stripManagedEmphasisDelimitersForCounting(text);
}

// Open the window for a prompt field. The model's tokenizer may still be loading (Qwen loads on
// first use), so it is awaited rather than failing with a console error.
async function openTokenDisplayModal(textarea) {
    if (!textarea) return;
    let tokenizer = null;
    try {
        // ensurePromptTokenizerForModel: public/scripts/comp/utilities.js
        tokenizer = typeof ensurePromptTokenizerForModel === 'function'
            ? await ensurePromptTokenizerForModel()
            : getPromptTokenizer();
    } catch (error) {
        console.error('Token Analysis: tokenizer failed to load', error);
    }
    if (!tokenizer) {
        showGlassToast('error', 'Token Analysis', 'The tokenizer is not loaded yet.', false, 5000, '<i class="nai-cross"></i>');
        return;
    }
    if (!getTokenAnalysisText(textarea.value).trim()) {
        showGlassToast('info', 'Token Analysis', 'There is no text to analyze.', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }

    setTokenAnalysisTextarea(textarea);
    tokenAnalysisSelected = -1;
    if (!renderTokenAnalysis()) return;

    const modal = document.getElementById('tokenDisplayModal');
    if (modal) {
        openModal(modal);
    }
}

function setTokenAnalysisTextarea(textarea) {
    if (tokenAnalysisTextarea === textarea) return;
    if (tokenAnalysisTextarea) tokenAnalysisTextarea.removeEventListener('input', scheduleTokenAnalysisRefresh);
    tokenAnalysisTextarea = textarea;
    if (textarea) textarea.addEventListener('input', scheduleTokenAnalysisRefresh);
}

function scheduleTokenAnalysisRefresh() {
    const modal = document.getElementById('tokenDisplayModal');
    if (!modal || modal.classList.contains('hidden')) return;
    clearTimeout(tokenAnalysisRefreshTimer);
    tokenAnalysisRefreshTimer = setTimeout(() => {
        tokenAnalysisRefreshTimer = 0;
        renderTokenAnalysis();
    }, TOKEN_ANALYSIS_REFRESH_MS);
}

/** Analyse the field and fill the window. Returns false (with a toast) when analysis fails. */
function renderTokenAnalysis() {
    const textarea = tokenAnalysisTextarea;
    const tokenizer = getPromptTokenizer();
    const box = document.getElementById('tokenModalDisplay');
    if (!textarea || !tokenizer || !box) return false;

    const text = getTokenAnalysisText(textarea.value);
    let tokens = [];
    if (text.trim()) {
        try {
            const analysis = tokenizer.analyzeTexts([text], true);
            tokens = analysis?.results?.[0]?.detailedTokens;
        } catch (error) {
            console.error('Token Analysis failed:', error);
            tokens = null;
        }
        if (!Array.isArray(tokens)) {
            showGlassToast('error', 'Token Analysis', 'The prompt could not be analyzed.', false, 5000, '<i class="nai-cross"></i>');
            return false;
        }
    }
    tokenAnalysisTokens = tokens;
    // t5Tokenizer / qwenTokenizer: public/protected/*-tokenizer.js (only T5 has scores)
    tokenAnalysisTokenizerLabel = (typeof qwenTokenizer !== 'undefined' && tokenizer === qwenTokenizer) ? 'Qwen' : 'T5';
    if (tokenAnalysisSelected >= tokens.length) tokenAnalysisSelected = tokens.length - 1;

    const field = describeTokenAnalysisField(textarea);
    const fieldEl = document.getElementById('tokenModalField');
    if (fieldEl) fieldEl.textContent = `${field.name}:`;
    const countEl = document.getElementById('tokenModalCount');
    if (countEl) countEl.textContent = describeTokenAnalysisCount(tokens.length, field.group, textarea);

    box.innerHTML = tokens.length
        ? tokens.map((token, index) => buildTokenAnalysisItem(token, index)).join('')
        : '<span class="token-analysis-empty">There is no text to analyze.</span>';
    renderTokenAnalysisDetails();
    return true;
}

/** "37 tokens" plus the group total against the model's limit, as the token bar counts it. */
function describeTokenAnalysisCount(count, group, textarea) {
    const parts = [`${count} token${count === 1 ? '' : 's'}`];
    const toolbar = typeof promptTextareaToolbar !== 'undefined' ? promptTextareaToolbar : null;
    const totals = toolbar && toolbar._groupTotalsReady ? toolbar._groupTotals : null;
    // getPromptTokenLimit: public/scripts/comp/utilities.js
    const limit = typeof getPromptTokenLimit === 'function' ? getPromptTokenLimit() : null;
    if (totals) {
        // the toolbar recounts on its own schedule: correct its total by this field's new count
        const cached = toolbar._fieldTokenCache && toolbar._fieldTokenCache.get(textarea);
        const delta = cached && Number.isFinite(cached.count) ? count - cached.count : 0;
        const total = delta + (group === 'uc'
            ? Math.max(0, totals.editableUc) + Math.max(0, totals.neUc)
            : Math.max(0, totals.editablePrompt) + Math.max(0, totals.nePrompt));
        const groupName = group === 'uc' ? 'Undesired Content' : 'prompt';
        parts.push(limit ? `${total} of ${limit} in the ${groupName}` : `${total} in the ${groupName}`);
    }
    return parts.join(', ');
}

function getTokenAnalysisKind(token) {
    if (token.isSpecial) return 'special';
    if (!token.isValid) return 'unknown';
    return 'word';
}

// One token: its text with the tokenizer's word-start mark as a space, tinted in turn (three
// tints, as NovelAI's tokenizer page), special and unknown tokens in their own colours.
function buildTokenAnalysisItem(token, index) {
    const kind = getTokenAnalysisKind(token);
    const display = String(token.text || '').replace(/▁/g, ' ');
    const tone = kind === 'word' ? ` tone-${index % 3}` : '';
    return `<span class="token-analysis-item is-${kind}${tone}${index === tokenAnalysisSelected ? ' is-selected' : ''}" role="option" data-index="${index}" aria-selected="${index === tokenAnalysisSelected}">${escapeHtml(display)}</span>`;
}

function renderTokenAnalysisDetails() {
    const dl = document.getElementById('tokenModalDetails');
    if (!dl) return;
    const token = tokenAnalysisTokens[tokenAnalysisSelected];
    if (!token) {
        dl.innerHTML = `<dt>Tokenizer</dt><dd>${tokenAnalysisTokenizerLabel}</dd><dt>Token</dt><dd class="token-analysis-hint">Click a token to see its properties.</dd>`;
        return;
    }
    const kind = getTokenAnalysisKind(token);
    const type = kind === 'special' ? 'Special token' : (kind === 'unknown' ? 'Unknown (not in the vocabulary)' : 'Text');
    const rows = [
        ['Position', `${tokenAnalysisSelected + 1} of ${tokenAnalysisTokens.length}`],
        ['Token ID', String(token.tokenId)],
        ['Text', `"${String(token.text || '').replace(/▁/g, ' ')}"`],
        ['Type', type]
    ];
    // only T5 has piece scores; Qwen's strength is always 0
    if (tokenAnalysisTokenizerLabel === 'T5' && kind === 'word') {
        const strength = Number(token.strength);
        const score = Number(token.rawScore);
        rows.push(['Strength', Number.isFinite(strength) ? `${strength.toFixed(2)} of 10 (rarer pieces weigh more)` : 'Unknown']);
        if (Number.isFinite(score)) rows.push(['Score', score.toFixed(4)]);
    }
    rows.push(['Tokenizer', tokenAnalysisTokenizerLabel]);
    dl.innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function selectTokenAnalysisItem(index, { scroll = true } = {}) {
    const box = document.getElementById('tokenModalDisplay');
    if (!box || !tokenAnalysisTokens.length) return;
    const next = Math.max(0, Math.min(tokenAnalysisTokens.length - 1, index));
    const prev = box.querySelector('.token-analysis-item.is-selected');
    if (prev) {
        prev.classList.remove('is-selected');
        prev.setAttribute('aria-selected', 'false');
    }
    tokenAnalysisSelected = next;
    const item = box.querySelector(`.token-analysis-item[data-index="${next}"]`);
    if (item) {
        item.classList.add('is-selected');
        item.setAttribute('aria-selected', 'true');
        if (scroll) {
            // keep it in view inside the box only (scrollIntoView would also scroll the desktop)
            const top = item.offsetTop - box.clientTop;
            if (top < box.scrollTop) box.scrollTop = top;
            else if (top + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + item.offsetHeight - box.clientHeight;
        }
    }
    renderTokenAnalysisDetails();
}

function setupTokenModal() {
    const modal = document.getElementById('tokenDisplayModal');
    if (!modal) return;
    document.getElementById('closeTokenModalBtn')?.addEventListener('click', () => closeModal(modal));

    const box = document.getElementById('tokenModalDisplay');
    if (box) {
        box.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.token-analysis-item');
            if (item) selectTokenAnalysisItem(Number(item.dataset.index), { scroll: false });
        });
        box.addEventListener('keydown', (e) => {
            if (!tokenAnalysisTokens.length) return;
            const current = tokenAnalysisSelected < 0 ? -1 : tokenAnalysisSelected;
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = current + 1;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, current - 1);
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tokenAnalysisTokens.length - 1;
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            selectTokenAnalysisItem(next);
        });
    }

    // release the field when the window closes (taskbar, Esc, caption Close)
    new MutationObserver(() => {
        if (modal.classList.contains('hidden')) {
            clearTimeout(tokenAnalysisRefreshTimer);
            setTokenAnalysisTextarea(null);
        }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeTokenInfoClickHandlers();
        setupTokenModal();
    });
} else {
    initializeTokenInfoClickHandlers();
    setupTokenModal();
}
