/**
 * Novel button context menu — public/scripts/comp/novelContextMenu.js
 * Depends on: contextMenu.js, novelManager.js
 */

function setupNovelContextMenu() {
    const btn = document.getElementById('novelBtn');
    if (!btn || btn.dataset.novelCtxMenu) return;
    if (!contextMenu) return;
    btn.dataset.novelCtxMenu = '1';

    const config = {
        sections: [
            {
                type: 'list',
                items: [
                    {
                        text: 'Disable Novel',
                        icon: 'fas fa-book',
                        action: 'novel-disable'
                    },
                    {
                        text: 'Open Editor',
                        icon: 'fas fa-book-open',
                        action: 'novel-open-editor'
                    },
                    {
                        text: 'Generate',
                        icon: 'fas fa-pen-fancy',
                        action: 'novel-generate'
                    },
                    {
                        text: 'Undo Last Generation',
                        icon: 'fas fa-undo',
                        action: 'novel-undo',
                        loadfn: (menuItem) => {
                            const stack = window.novelSession?.metadata?.undo_stack
                                || window.novelSession?.note?.metadata?.undo_stack;
                            menuItem.disabled = !(stack && stack.length > 0);
                        }
                    },
                    {
                        text: 'Resume Story Advancement',
                        icon: 'fas fa-forward',
                        action: 'novel-toggle-resume-advance',
                        loadfn: (menuItem, target) => {
                            menuItem.checked = target?.dataset?.resumeAdvancement === 'true';
                        }
                    },
                    {
                        text: 'Select Novel Note…',
                        icon: 'fas fa-file-lines',
                        action: 'novel-select-note'
                    },
                    {
                        text: 'Create New Novel Note',
                        icon: 'fas fa-plus',
                        action: 'novel-new-note'
                    },
                    {
                        text: 'Tone',
                        icon: 'fas fa-theater-masks',
                        openOnHover: true,
                        optionsfn: () => NOVEL_TONE_OPTIONS.map((o) => ({
                            text: o.label,
                            action: 'novel-set-tone',
                            data: { value: o.value }
                        }))
                    },
                    {
                        text: 'Style',
                        icon: 'fas fa-feather',
                        openOnHover: true,
                        optionsfn: () => NOVEL_STYLE_OPTIONS.map((o) => ({
                            text: o.label,
                            action: 'novel-set-style',
                            data: { value: o.value }
                        }))
                    },
                    {
                        text: 'Explicitness',
                        icon: 'fas fa-eye',
                        openOnHover: true,
                        optionsfn: () => NOVEL_EXPLICITNESS_OPTIONS.map((o) => ({
                            text: o.label,
                            action: 'novel-set-explicitness',
                            data: { value: o.value }
                        }))
                    },
                    {
                        text: 'Persuasiveness',
                        icon: 'fas fa-bullhorn',
                        openOnHover: true,
                        optionsfn: () => NOVEL_PERSUASIVENESS_OPTIONS.map((o) => ({
                            text: o.label,
                            action: 'novel-set-persuasiveness',
                            data: { value: o.value }
                        }))
                    },
                    {
                        text: 'Auto Generate',
                        icon: 'fas fa-bolt',
                        openOnHover: true,
                        optionsfn: (target) => [
                            { text: 'On', action: 'novel-set-auto-generate', data: { value: 'true' }, checked: target?.dataset?.autoGenerate !== 'false' },
                            { text: 'Off', action: 'novel-set-auto-generate', data: { value: 'false' }, checked: target?.dataset?.autoGenerate === 'false' }
                        ]
                    }
                ]
            }
        ],
        onAction: (action, target, item) => {
            if (action === 'novel-open-editor') {
                openNovelEditorTool();
            } else if (action === 'novel-disable') {
                target.dataset.state = 'off';
                target.classList.remove('active');
            } else if (action === 'novel-generate') {
                const session = window.novelSession;
                if (!session?.noteId) return;
                novelRunGenerate({ noteId: session.noteId });
            } else if (action === 'novel-undo') {
                novelRunUndo();
            } else if (action === 'novel-toggle-resume-advance') {
                const resumed = target.dataset.resumeAdvancement === 'true';
                target.dataset.resumeAdvancement = resumed ? 'false' : 'true';
            } else if (action === 'novel-new-note') {
                window.novelSession = null;
                const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
                novelEnsureNote(ws).then(() => openNovelEditorTool());
            } else if (action === 'novel-select-note') {
                novelOpenSelectNoteDialog();
            } else if (action === 'novel-set-tone' && item.data) {
                target.dataset.tone = item.data.value;
                novelPersistSettings();
            } else if (action === 'novel-set-style' && item.data) {
                target.dataset.style = item.data.value;
                novelPersistSettings();
            } else if (action === 'novel-set-explicitness' && item.data) {
                target.dataset.explicitness = item.data.value;
                novelPersistSettings();
            } else if (action === 'novel-set-persuasiveness' && item.data) {
                target.dataset.persuasiveness = item.data.value;
                novelPersistSettings();
            } else if (action === 'novel-set-auto-generate' && item.data) {
                target.dataset.autoGenerate = item.data.value;
                novelPersistSettings();
            }
        }
    };

    contextMenu.attachToElement(btn, config);
}

async function novelOpenSelectNoteDialog() {
    if (!wsClient) return;
    const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
    const result = await wsClient.novelList(ws);
    const novels = result?.novels || result?.data?.novels || [];
    if (!novels.length) {
        if (typeof showToast === 'function') showToast('No novel notes in this workspace', 'info');
        return;
    }
    const listHtml = novels.map((n) => `
        <button type="button" class="note-selection-item novel-select-item" data-novel-id="${n.id}" style="width:100%;text-align:left;margin-bottom:0.35rem;">
            <i class="fas fa-book-open" style="color:#9c27b0;"></i>
            <span class="note-name">${(n.name || 'Untitled').replace(/</g, '&lt;')}</span>
        </button>`).join('');
    if (typeof showConfirmationDialog !== 'function') {
        await novelLoadNote(novels[0].id);
        const btn = novelGetBtn();
        if (btn) {
            btn.dataset.state = 'on';
            btn.classList.add('active');
        }
        openNovelEditorTool();
        return;
    }
    const pickPromise = showConfirmationDialog(
        `<div class="novel-select-list">${listHtml}</div>`,
        [{ text: 'Cancel', value: null, className: 'btn-standard' }],
        null,
        { title: 'Select Novel Note' }
    );
    setTimeout(() => {
        const dialog = document.getElementById('confirmationDialog');
        const list = dialog?.querySelector('.novel-select-list');
        if (!list) return;
        list.querySelectorAll('[data-novel-id]').forEach((item) => {
            item.addEventListener('click', async () => {
                const noteId = item.getAttribute('data-novel-id');
                if (!noteId) return;
                if (typeof hideConfirmationDialog === 'function') hideConfirmationDialog();
                await novelLoadNote(noteId);
                const btn = novelGetBtn();
                if (btn) {
                    btn.dataset.state = 'on';
                    btn.classList.add('active');
                }
                openNovelEditorTool();
            });
        });
    }, 0);
    await pickPromise;
}
