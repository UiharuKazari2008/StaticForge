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
            showGlassToast('success', null, 'Feedback saved successfully. The AI will learn from this.', false, undefined, '<i class="fas fa-check"></i>');
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

// Director Rules Manager Functions
let directorRules = [];
let directorFeedback = [];
let currentDirectorView = 'rules'; // 'rules' or 'feedback'

async function showDirectorRulesManager() {
    // Rules/Feedback manager has been moved into the Memories DSAP applet
    // at dsap://memories.dyna.dreamscape.jp/static_rules (and /feedback)
    if (typeof openDsapInGrimoire === 'function') {
        openDsapInGrimoire('dsap://memories.dyna.dreamscape.jp/static_rules');
        return;
    }
    // Last resort: try to open the memories DSAP root
    if (typeof openKnowledgeMemoriesModal === 'function') {
        openKnowledgeMemoriesModal();
    } else {
        console.warn('Director Rules are now at dsap://memories.dyna.dreamscape.jp/static_rules');
    }
}

async function loadDirectorRules() {
    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.sendMessage('director_load_rules', {});

        if (result && result.data && result.data.success) {
            directorRules = result.data.rules || [];
        } else {
            directorRules = [];
        }
    } catch (error) {
        console.error('Error loading director rules:', error);
        directorRules = [];
        showGlassToast('error', null, `Failed to load rules: ${error.message}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

function renderDirectorRulesList() {
    const list = document.getElementById('directorRulesList');
    if (!list) return;

    if (directorRules.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-book-open"></i>
                <p>No rules defined yet.</p>
                <p class="text-muted">Click the <i class="fas fa-plus"></i> button above to add your first rule.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = directorRules.map((rule, index) => `
        <div class="director-rule-item" data-rule-id="${rule.id}">
            <div class="director-rule-content">
                <div class="director-rule-text" contenteditable="true" data-rule-index="${index}">${escapeHtml(rule.text)}</div>
                <div class="director-rule-actions">
                    <button type="button" class="btn-danger btn-small delete-rule-btn" data-rule-id="${rule.id}" title="Delete Rule">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    // Add event listeners for inline editing
    list.querySelectorAll('.director-rule-text').forEach(element => {
        element.addEventListener('blur', handleDirectorRuleEdit);
        element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                element.blur();
            }
        });
    });

    // Add event listeners for delete buttons
    list.querySelectorAll('.delete-rule-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteDirectorRule(btn.dataset.ruleId));
    });
}

async function handleDirectorRuleEdit(e) {
    const element = e.target;
    const index = parseInt(element.dataset.ruleIndex);
    const newText = element.textContent.trim();

    if (!newText) {
        showGlassToast('error', null, 'Rule text cannot be empty.', false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
        renderDirectorRulesList();
        return;
    }

    // Update local array
    directorRules[index].text = newText;

    // Save to backend
    await saveDirectorRules();
}

async function addDirectorRule() {
    const newRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        text: 'New rule - click to edit',
        created: new Date().toISOString()
    };

    directorRules.push(newRule);
    renderDirectorRulesList();

    // Focus on the new rule
    setTimeout(() => {
        const newElement = document.querySelector(`[data-rule-id="${newRule.id}"] .director-rule-text`);
        if (newElement) {
            newElement.focus();
            // Select all text
            const range = document.createRange();
            range.selectNodeContents(newElement);
            const selection = getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }, 100);

    // Save to backend
    await saveDirectorRules();
}

async function deleteDirectorRule(ruleId) {
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this rule?',
        [
            {
                text: 'Delete',
                value: true,
                className: 'btn-danger',
                icon: 'fas fa-trash'
            },
            {
                text: 'Cancel',
                value: false,
                className: 'btn-secondary'
            }
        ]
    );

    if (!confirmed) return;

    // Remove from array
    directorRules = directorRules.filter(rule => rule.id !== ruleId);

    // Re-render list
    renderDirectorRulesList();

    // Save to backend
    await saveDirectorRules();

    showGlassToast('success', null, 'Rule deleted successfully.', false, undefined, '<i class="fas fa-check"></i>');
}

async function saveDirectorRules() {
    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.sendMessage('director_save_rules', {
            rules: directorRules
        });

        if (result && result.data && result.data.success) {
            console.log('✅ Director rules saved successfully');
        } else {
            throw new Error(result?.data?.message || 'Failed to save rules');
        }
    } catch (error) {
        console.error('Error saving director rules:', error);
        showGlassToast('error', null, `Failed to save rules: ${error.message}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Load director feedback
async function loadDirectorFeedback() {
    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.sendMessage('director_load_feedback', {});

        if (result && result.data && result.data.success) {
            directorFeedback = result.data.feedback || [];
            console.log('Director feedback loaded successfully:', directorFeedback.length, 'entries');
        } else {
            directorFeedback = [];
            console.warn('Failed to load director feedback:', result);
        }
    } catch (error) {
        console.error('Error loading director feedback:', error);
        directorFeedback = [];
        // Don't show error toast on initial load
    }
}

// Render director feedback list
function renderDirectorFeedbackList() {
    const list = document.getElementById('directorRulesList');
    if (!list) {
        console.error('directorRulesList element not found');
        return;
    }

    console.log('Rendering feedback list, count:', directorFeedback.length);

    if (!directorFeedback || directorFeedback.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comment-alt"></i>
                <p>No feedback entries yet.</p>
                <p class="text-muted">Feedback entries are created when you report issues with AI replacements.</p>
            </div>
        `;
        return;
    }

    try {
        list.innerHTML = directorFeedback.map((feedback) => {
            if (!feedback || !feedback.id) {
                console.warn('Invalid feedback entry:', feedback);
                return '';
            }

            const date = feedback.timestamp ? new Date(feedback.timestamp).toLocaleDateString() : 'Unknown date';
            const selectText = feedback?.select_text || '';
            const replaceText = feedback.replace_text || '';
            const action = feedback.action || 'replace';
            const aiReason = feedback.ai_reason || '(no reason provided)';
            const userFeedback = feedback.user_feedback || '(no feedback provided)';

            return `<div class="director-rule-item director-feedback-item" data-feedback-id="${feedback.id}">
<div class="director-rule-content">
<div class="director-feedback-main">
<div class="director-feedback-header">
<div class="director-feedback-meta">
<span class="director-feedback-date"><i class="fas fa-calendar-alt"></i> ${escapeHtml(date)}</span>
${action ? `<span class="director-feedback-action"><i class="fas fa-exchange-alt"></i> ${escapeHtml(action)}</span>` : ''}
</div>
</div>
<div class="director-rule-text" contenteditable="true" data-feedback-id="${feedback.id}" style="white-space: pre-wrap; min-height: 60px; max-height: 200px; overflow-y: auto;">${escapeHtml(userFeedback)}</div>
<div class="director-feedback-details">
${selectText ? `<div class="director-feedback-detail-row"><span class="detail-label"><i class="fas fa-arrow-left"></i> Original:</span><span class="detail-value selectable">${escapeHtml(selectText)}</span></div>` : ''}
${replaceText ? `<div class="director-feedback-detail-row"><span class="detail-label"><i class="fas fa-arrow-right"></i> Replacement:</span><span class="detail-value selectable">${escapeHtml(replaceText)}</span></div>` : ''}
<div class="director-feedback-detail-row"><span class="detail-label"><i class="fas fa-robot"></i> AI Reason:</span><span class="detail-value selectable">${escapeHtml(aiReason)}</span></div>
</div>
</div>
<div class="director-rule-actions">
<button type="button" class="btn-danger btn-small delete-feedback-btn" data-feedback-id="${feedback.id}" title="Delete Feedback">
<i class="fas fa-trash"></i>
</button>
</div>
</div>
</div>`;
        }).filter(html => html).join('');

        // Add event listeners for delete buttons
        list.querySelectorAll('.delete-feedback-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteDirectorFeedback(btn.dataset.feedbackId));
        });

        // Add event listeners for editable feedback text
        list.querySelectorAll('.director-rule-text[data-feedback-id]').forEach(element => {
            element.addEventListener('blur', handleDirectorFeedbackEdit);
            element.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    element.blur();
                }
            });
        });
    } catch (error) {
        console.error('Error rendering feedback list:', error);
        list.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error rendering feedback entries.</p>
                <p class="text-muted">${escapeHtml(error.message)}</p>
            </div>
        `;
    }
}

// Handle director feedback text edit
async function handleDirectorFeedbackEdit(e) {
    const element = e.target;
    const feedbackId = element.dataset.feedbackId;
    const newText = element.textContent.trim();

    if (!feedbackId || !newText) {
        // Restore original text if empty
        const feedback = directorFeedback.find(fb => fb.id === feedbackId);
        if (feedback) {
            element.textContent = feedback.user_feedback || '(no feedback provided)';
        }
        return;
    }

    // Update local array
    const feedback = directorFeedback.find(fb => fb.id === feedbackId);
    if (feedback) {
        feedback.user_feedback = newText;
        // Note: We don't save feedback edits back to the server as feedback is typically read-only
        // If you want to save edits, uncomment the following:
        // await saveDirectorFeedback(feedback);
    }
}

// Delete director feedback
async function deleteDirectorFeedback(feedbackId) {
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this feedback entry?',
        [
            {
                text: 'Delete',
                value: true,
                className: 'btn-danger',
                icon: 'fas fa-trash'
            },
            {
                text: 'Cancel',
                value: false,
                className: 'btn-secondary'
            }
        ]
    );

    if (!confirmed) return;

    try {
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.sendMessage('director_delete_feedback', {
            feedbackId: feedbackId
        });

        if (result && result.data && result.data.success) {
            // Remove from local array
            directorFeedback = directorFeedback.filter(fb => fb.id !== feedbackId);

            // Re-render list
            renderDirectorFeedbackList();

            showGlassToast('success', null, 'Feedback deleted successfully.', false, undefined, '<i class="fas fa-check"></i>');
        } else {
            throw new Error(result?.data?.message || 'Failed to delete feedback');
        }
    } catch (error) {
        console.error('Error deleting director feedback:', error);
        showGlassToast('error', null, `Failed to delete feedback: ${error.message}`, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Setup director view dropdown
function setupDirectorViewDropdown() {
    const dropdown = document.getElementById('directorRulesViewDropdown');
    const button = document.getElementById('directorRulesViewDropdownBtn');
    const menu = document.getElementById('directorRulesViewDropdownMenu');
    const selected = document.getElementById('directorRulesViewDropdownSelected');

    if (!dropdown || !button || !menu || !selected) return;

    const viewOptions = [
        { value: 'rules', name: 'Global' },
        { value: 'feedback', name: 'Feedback' }
    ];

    function renderViewDropdown(selectedValue) {
        renderSimpleDropdown(
            menu,
            viewOptions,
            'value',
            'name',
            selectDirectorView,
            closeDirectorViewDropdown,
            selectedValue,
            { preventFocusTransfer: true }
        );
    }

    async function selectDirectorView(value) {
        currentDirectorView = value;
        const option = viewOptions.find(opt => opt.value === value);
        selected.textContent = option ? option.name : 'Global';

        // Update UI and render appropriate list
        updateDirectorViewUI();

        if (currentDirectorView === 'rules') {
            await loadDirectorRules();
            renderDirectorRulesList();
        } else {
            await loadDirectorFeedback();
            renderDirectorFeedbackList();
        }
    }

    function closeDirectorViewDropdown() {
        closeDropdown(menu, button);
    }

    function getSelectedView() {
        return currentDirectorView;
    }

    // Setup dropdown
    setupDropdown(dropdown, button, menu, renderViewDropdown, getSelectedView, { preventFocusTransfer: true });
}

// Update UI based on current view
function updateDirectorViewUI() {
    const addBtn = document.getElementById('addDirectorRuleBtn');
    const infoSection = document.querySelector('#directorRulesModal .info-section');

    if (currentDirectorView === 'rules') {
        // Show add button and info section for rules
        if (addBtn) addBtn.style.display = '';
        if (infoSection) infoSection.style.display = '';
    } else {
        // Hide add button and info section for feedback
        if (addBtn) addBtn.style.display = 'none';
        if (infoSection) infoSection.style.display = 'none';
    }
}

function closeDirectorRulesModal() {
    const modal = document.getElementById('directorRulesModal');
    if (modal) {
        closeModal(modal);
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

function attachDirectorRulesModalListeners(signal) {
    const closeDirectorRulesBtn = document.getElementById('closeDirectorRulesBtn');
    if (closeDirectorRulesBtn) {
        closeDirectorRulesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeDirectorRulesModal();
        }, { signal });
    }

    const addDirectorRuleBtn = document.getElementById('addDirectorRuleBtn');
    if (addDirectorRuleBtn) {
        addDirectorRuleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addDirectorRule();
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
    const rulesModal = document.getElementById('directorRulesModal');
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    if (feedbackModal) {
        attachModalListeners(feedbackModal, attachDirectorFeedbackModalListeners);
    }
    if (rulesModal) {
        attachModalListeners(rulesModal, attachDirectorRulesModalListeners);
    }
    wireDirectorFeedbackKeyboard();
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(478, 'Director learning admin listener scope', async () => {
        initDirectorLearningAdminListenerScope();
    });
}
