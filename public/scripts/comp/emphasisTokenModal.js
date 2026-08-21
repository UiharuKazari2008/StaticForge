// Token display modal for emphasis textareas

function initializeTokenInfoClickHandlers() {
    if (tokenInfoClickHandlersWired) {
        return;
    }
    tokenInfoClickHandlersWired = true;

    // Add click handlers to all token-info-containers
    document.addEventListener('click', (e) => {
        const tokenInfo = e.target.closest('.token-info-container');
        if (!tokenInfo) return;
        
        // Find the associated textarea
        const toolbar = tokenInfo.closest('.prompt-textarea-toolbar');
        if (!toolbar) return;
        
        // Find the textarea - it's a sibling of the toolbar within the container
        const container = toolbar.parentElement;
        if (!container) return;
        
        // Look for textarea in the container (UC tab has two fields; prefer the one that was focused)
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
            // Open token display modal
            openTokenDisplayModal(textarea);
        }
    });
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ============================================================================
// Token Display Modal System
// ============================================================================

// Open token display modal with highlighted tokens
function openTokenDisplayModal(textarea) {
    if (!textarea || !t5Tokenizer) {
        console.error('Cannot open token modal: missing textarea or tokenizer');
        return;
    }
    
    const rawText = textarea.value;
    // Same strip as the token bar — managed ZW / visible :MAGIC: must not become <unk>.
    // stripTextForTokenCount: public/scripts/comp/promptTextareaToolbar.js
    // stripManagedEmphasisDelimitersForCounting: public/scripts/comp/emphasisGroupIdCodec.js
    // stripPromptBlocksForEffectivePrompt: public/scripts/comp/promptStageBlocks.js
    let text;
    if (typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar
        && typeof promptTextareaToolbar.stripTextForTokenCount === 'function') {
        text = promptTextareaToolbar.stripTextForTokenCount(rawText || '');
    } else {
        text = stripPromptBlocksForEffectivePrompt(rawText || '', {
            stageIndex: 0,
            pipelineStageGeneration: false
        });
        text = stripManagedEmphasisDelimitersForCounting(text);
    }
    if (!text.trim()) {
        showGlassToast('info', 'Info', 'No text to analyze', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }
    
    try {
        // Analyze after stage + managed-delim strip (matches toolbar count)
        const analysis = t5Tokenizer.analyzeTexts([text], true);
        if (!analysis?.results?.[0]?.detailedTokens) {
            showGlassToast('error', 'Error', 'Failed to analyze tokens', false, 5000, '<i class="nai-cross"></i>');
            return;
        }
        
        const tokens = analysis.results[0].detailedTokens;
        
        // Generate highlighted token display
        const tokenDisplay = generateTokenDisplay(tokens, text);
        document.getElementById('tokenModalDisplay').innerHTML = tokenDisplay;
        
        // Open modal
        const modal = document.getElementById('tokenDisplayModal');
        if (modal) {
            openModal(modal);
        }
        
    } catch (error) {
        console.error('Error opening token modal:', error);
        showGlassToast('error', 'Error', 'Failed to analyze tokens', false, 5000, '<i class="nai-cross"></i>');
    }
}

// Generate HTML display for tokens with highlighting
function generateTokenDisplay(tokens, originalText) {
    // Display tokens with alternating background colors like in the images
    let output = '';
    let colorIndex = 0;
    
    for (const token of tokens) {
        const displayText = token.text.replace(/▁/g, ' ');
        const tokenElement = createTokenElement(token, displayText, colorIndex);
        output += tokenElement;
        colorIndex = (colorIndex + 1) % 3; // Cycle through 3 colors
    }
    
    return output;
}

// Create HTML element for a single token
function createTokenElement(token, displayText, colorIndex = 0) {
    const escapedText = escapeHtml(displayText);
    
    // Determine background color based on alternating pattern
    let backgroundColor;
    switch (colorIndex) {
        case 0:
            backgroundColor = 'rgba(128, 64, 128, 0.4)'; // Dark purple
            break;
        case 1:
            backgroundColor = 'rgba(64, 128, 64, 0.4)'; // Dark green
            break;
        case 2:
            backgroundColor = 'rgba(64, 96, 128, 0.4)'; // Dark blue
            break;
        default:
            backgroundColor = 'rgba(128, 64, 128, 0.4)';
    }
    
    // Special handling for special tokens
    if (token.isSpecial) {
        backgroundColor = 'rgba(150, 150, 150, 0.4)'; // Gray for special tokens
    } else if (!token.isValid) {
        backgroundColor = 'rgba(200, 64, 64, 0.4)'; // Red for invalid tokens
    }
    
    // Create tooltip content
    const tooltipContent = createTokenTooltip(token);
    
    return `<span class="token-highlight" data-token-id="${token.tokenId}" title="${escapedText}" style="background: ${backgroundColor};">${escapedText}<div class="token-tooltip">${tooltipContent}</div></span>`;
}

// Create tooltip content for token
function createTokenTooltip(token) {
    const parts = [];
    
    parts.push(`ID: ${token.tokenId}`);
    parts.push(`Text: "${token.text}"`);
    
    if (token.isSpecial) {
        parts.push('Type: Special Token');
    } else if (!token.isValid) {
        parts.push('Type: Invalid Token');
    } else {
        parts.push(`Strength: ${token.strength.toFixed(4)}`);
        parts.push('Type: Valid Token');
    }
    
    return parts.join('<br>');
}

// Setup token modal event listeners
function setupTokenModal() {
    // Close button
    const closeBtn = document.getElementById('closeTokenModalBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('tokenDisplayModal');
            if (modal) {
                closeModal(modal);
            }
        });
    }
    
    // Close on backdrop click
    const modal = document.getElementById('tokenDisplayModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal);
            }
        });
    }
}

// Initialize token modal system on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeTokenInfoClickHandlers();
        setupTokenModal();
    });
} else {
    initializeTokenInfoClickHandlers();
    setupTokenModal();
}