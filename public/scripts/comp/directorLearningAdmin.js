/**
 * Director feedback modal and rules/feedback admin (legacy modal paths).
 * Wired via registerInitStep 478.
 */

// Director Feedback Modal Functions
function showDirectorFeedbackModal(selectText, replaceText, action, reason) {
    const modal = document.getElementById('directorFeedbackModal');
    if (!modal) {
        console.error('Director feedback modal not found');
        return;
    }

    // Populate the form
    document.getElementById('feedbackSelectText').value = selectText || '';
    document.getElementById('feedbackReplaceText').value = replaceText || '';
    document.getElementById('feedbackAction').value = action || 'replace';
    document.getElementById('feedbackReason').value = reason || '';
    document.getElementById('feedbackDescription').value = '';

    // Show the modal
    openModal(modal);

    // Focus on the description textarea
    setTimeout(() => {
        document.getElementById('feedbackDescription').focus();
    }, 100);
}

async function saveDirectorFeedback() {
    const selectText = document.getElementById('feedbackSelectText').value;
    const replaceText = document.getElementById('feedbackReplaceText').value;
    const action = document.getElementById('feedbackAction').value;
    const reason = document.getElementById('feedbackReason').value;
    const description = document.getElementById('feedbackDescription').value.trim();

    // Validate description
    if (!description) {
        showGlassToast('error', null, 'Please describe what went wrong with this replacement.', false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Send via WebSocket
    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.sendMessage('director_save_feedback', {
            select_text: selectText,
            replace_text: replaceText,
            action: action,
            ai_reason: reason,
            user_feedback: description,
            timestamp: new Date().toISOString()
        });

        if (result && result.data && result.data.success) {
            showGlassToast('success', null, 'Feedback saved successfully. The SI will learn from this.', false, undefined, '<i class="fas fa-check"></i>');
            closeDirectorFeedbackModal();
        } else {
            throw new Error(result?.data?.message || 'Failed to save feedback');
        }
    } catch (error) {
        console.error('Error saving feedback:', error);
        showGlassToast('error', null, `Failed to save feedback: ${error.message}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

function closeDirectorFeedbackModal() {
    const modal = document.getElementById('directorFeedbackModal');
    if (modal) {
        closeModal(modal);
        // Clear the form
        document.getElementById('feedbackDescription').value = '';
    }
}


function attachDirectorFeedbackModalListeners(signal) {
    const closeDirectorFeedbackBtn = document.getElementById('closeDirectorFeedbackBtn');
    if (closeDirectorFeedbackBtn) {
        closeDirectorFeedbackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeDirectorFeedbackModal();
        }, { signal });
    }

    const saveFeedbackBtn = document.getElementById('saveFeedbackBtn');
    if (saveFeedbackBtn) {
        saveFeedbackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            saveDirectorFeedback();
        }, { signal });
    }
}

function handleDirectorFeedbackModalKeydown(e) {
    const modal = document.getElementById('directorFeedbackModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        saveDirectorFeedback();
        return true;
    }
}

let directorFeedbackKeyboardWired = false;

function wireDirectorFeedbackKeyboard() {
    if (directorFeedbackKeyboardWired) return;
    directorFeedbackKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'directorFeedbackModal.keydown',
        handler: handleDirectorFeedbackModalKeydown,
        type: 'whenFocused',
        modalId: 'directorFeedbackModal',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('directorFeedbackModal', 'Rentan', [
        { id: 'overlay.directorFeedback.submit', label: 'Submit feedback', keys: 'Ctrl+Enter', icon: 'fas fa-paper-plane' },
        { id: 'overlay.directorFeedback.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
}

function initDirectorLearningAdminListenerScope() {
    const feedbackModal = document.getElementById('directorFeedbackModal');
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    if (feedbackModal) {
        attachModalListeners(feedbackModal, attachDirectorFeedbackModalListeners);
    }
    wireDirectorFeedbackKeyboard();
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(478, 'Director learning admin listener scope', async () => {
        initDirectorLearningAdminListenerScope();
    });
}
