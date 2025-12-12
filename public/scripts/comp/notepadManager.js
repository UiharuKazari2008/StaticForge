// Notepad Manager
// Manages notepad modals with text editing, save functionality, and workspace integration
// Follows the cloning pattern like ImageViewerManager

// Preset note icons (FontAwesome)
const NOTE_PRESET_ICONS = [
    { icon: 'fas fa-sticky-note', label: 'Sticky' },
    { icon: 'fas fa-note', label: 'Note' },
    { icon: 'fas fa-memo', label: 'Memo' },
    { icon: 'fas fa-clipboard', label: 'Clipboard' },
    { icon: 'fas fa-list-check', label: 'List' },
    { icon: 'fas fa-lightbulb', label: 'Idea' },
    { icon: 'fas fa-file-lines', label: 'Document' },
    { icon: 'fas fa-file-heart', label: 'Favorite' },
    { icon: 'fas fa-bookmark', label: 'Bookmark' },
    { icon: 'fas fa-file-magnifying-glass', label: 'Research' },
    { icon: 'fas fa-file-code', label: 'Code' },
    { icon: 'fas fa-file-exclamation', label: 'Important' },
    { icon: 'fas fa-file-prescription', label: 'Rx' },
    { icon: 'fas fa-flag', label: 'Flag' }
];

// Preset sticky note colors with funky names
const NOTE_PRESET_COLORS = [
    { color: '#ffc107', label: 'Banana Cream' },
    { color: '#ff9800', label: 'Sunset Glow' },
    { color: '#f44336', label: 'Cherry Pop' },
    { color: '#e91e63', label: 'Bubble Gum' },
    { color: '#9c27b0', label: 'Grape Soda' },
    { color: '#3f51b5', label: 'Ocean Deep' },
    { color: '#2196f3', label: 'Sky Blue' },
    { color: '#00bcd4', label: 'Ice Pop' },
    { color: '#009688', label: 'Sea Foam' },
    { color: '#4caf50', label: 'Lime Zest' },
    { color: '#8bc34a', label: 'Spring Green' },
    { color: '#cddc39', label: 'Electric Lime' }
];

class NotepadManager {
    constructor() {
        this.notepads = new Map(); // Map of notepad IDs to notepad instances
        this.nextId = 1;
        this.template = null;
        
        // Notebook-related properties
        this.notebookModal = null;
        this.notebookNotesList = null;
        this.notebookTextarea = null;
        this.notebookTitleElement = null;
        this.notebookCurrentNote = null;
        this.notebookHasUnsavedChanges = false;
        this.notebookSaveDebounceTimer = null;
        this.notebookSaveDebounceDelay = 2000;
    }

    // Initialize the notepad manager
    init() {
        this.template = document.getElementById('notepadModalTemplate');
        if (!this.template) {
            console.error('Notepad template not found');
            return;
        }

        // Get open note modal elements
        this.openNoteModal = document.getElementById('openNoteModal');
        this.openNoteList = document.getElementById('openNoteList');
        const closeOpenNoteModalBtn = document.getElementById('closeOpenNoteModalBtn');

        if (closeOpenNoteModalBtn) {
            closeOpenNoteModalBtn.addEventListener('click', () => {
                closeModal(this.openNoteModal);
            });
        }

        // Get update note modal elements
        this.updateNoteModal = document.getElementById('updateNoteModal');
        this.currentNoteBeingUpdated = null;
        const closeUpdateNoteModalBtn = document.getElementById('closeUpdateNoteModalBtn');
        const saveUpdateNoteBtn = document.getElementById('saveUpdateNoteBtn');

        if (closeUpdateNoteModalBtn) {
            closeUpdateNoteModalBtn.addEventListener('click', () => {
                closeModal(this.updateNoteModal);
            });
        }

        if (saveUpdateNoteBtn) {
            saveUpdateNoteBtn.addEventListener('click', () => {
                this.handleSaveUpdateNote();
            });
        }

        // Listen for WebSocket events
        this.initializeWebSocketListeners();

        // Initialize notebook modal
        this.initializeNotebook();

        // Save pending changes before page unload
        window.addEventListener('beforeunload', (e) => {
            const hasUnsaved = Array.from(this.notepads.values()).some(n => n.hasUnsavedChanges)
                || this.notebookHasUnsavedChanges;
            if (hasUnsaved) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes in notes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
    }

    // Initialize WebSocket listeners for notepad events
    initializeWebSocketListeners() {
        if (!wsClient) {
            console.warn('WebSocket client not available');
            return;
        }

        // Register handlers using wsClient.on()
        wsClient.on('note_created', (message) => {
            // Note created by another client or action
            // Refresh notebook list if open
            if (this.notebookModal && !this.notebookModal.classList.contains('hidden')) {
                this.notebookRefreshNotesList();
            }
        });

        wsClient.on('note_updated', (message) => {
            const data = message.data || message;
            // Route to specific notepad instance if open
            if (data && data.noteId) {
                const notepad = this.getNotepadByNoteId(data.noteId);
                if (notepad) {
                    notepad.handleNoteUpdated(data);
                }
                
                // Also update notebook if showing this note
                if (this.notebookCurrentNote && this.notebookCurrentNote.id === data.noteId) {
                    this.notebookLoadNote(data.noteId, false);
                }
                
                // Refresh notebook list if open
                if (this.notebookModal && !this.notebookModal.classList.contains('hidden')) {
                    this.notebookRefreshNotesList();
                }
            }
        });

        wsClient.on('note_deleted', (message) => {
            const data = message.data || message;
            // Close notepad if it's open
            if (data && data.noteId) {
                const notepad = this.getNotepadByNoteId(data.noteId);
                if (notepad) {
                    notepad.handleNoteDeleted();
                }
                
                // Clear notebook if showing this note
                if (this.notebookCurrentNote && this.notebookCurrentNote.id === data.noteId) {
                    this.notebookCurrentNote = null;
                    if (this.notebookTextarea) {
                        this.notebookTextarea.value = '';
                    }
                    this.notebookUpdateTitle();
                }
                
                // Refresh notebook list if open
                if (this.notebookModal && !this.notebookModal.classList.contains('hidden')) {
                    this.notebookRefreshNotesList();
                }
            }
        });

        wsClient.on('note_content_updated', (message) => {
            // Content was updated by another client
            // We could show a notification or refresh
        });
    }

    // Create a blank notepad (not saved yet)
    createBlankNotepad() {
        const notepadId = `notepad_${this.nextId++}`;
        const notepadElement = this.template.cloneNode(true);
        notepadElement.id = notepadId;

        // Update IDs to be unique
        this.updateElementIds(notepadElement, notepadId);

        // Insert into DOM
        document.body.appendChild(notepadElement);

        // Create notepad instance with null note (unsaved)
        const notepad = new Notepad(notepadId, notepadElement, null, this);
        this.notepads.set(notepadId, notepad);

        return notepad;
    }

    // Open an existing note from database
    async openExistingNote(noteId) {
        try {
            // Check if already open
            const existing = this.getNotepadByNoteId(noteId);
            if (existing) {
                bringModalToFront(existing.element);
                return existing;
            }

            // Fetch note data
            const response = await wsClient.getNote(noteId);

            if (!response || !response.note) {
                throw new Error('Note not found');
            }

            const note = response.note;

            // Create new instance
            const notepadId = `notepad_${this.nextId++}`;
            const notepadElement = this.template.cloneNode(true);
            notepadElement.id = notepadId;

            // Update IDs to be unique
            this.updateElementIds(notepadElement, notepadId);

            // Insert into DOM
            document.body.appendChild(notepadElement);

            // Create notepad instance
            const notepad = new Notepad(notepadId, notepadElement, note, this);
            this.notepads.set(notepadId, notepad);

            return notepad;
        } catch (error) {
            console.error('Error opening note:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to open note', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            return null;
        }
    }

    // Update element IDs to be unique for this notepad instance
    updateElementIds(element, notepadId) {
        const elementsWithIds = element.querySelectorAll('[id]');
        elementsWithIds.forEach(el => {
            const originalId = el.id;
            el.id = `${originalId}_${notepadId}`;
        });
    }

    // Remove a notepad instance
    removeNotepad(notepadId) {
        const notepad = this.notepads.get(notepadId);
        if (notepad) {
            notepad.destroy();
            this.notepads.delete(notepadId);
        }
    }

    // Get notepad by ID
    getNotepad(notepadId) {
        return this.notepads.get(notepadId);
    }

    // Get notepad by note ID
    getNotepadByNoteId(noteId) {
        for (const notepad of this.notepads.values()) {
            if (notepad.note && notepad.note.id === noteId) {
                return notepad;
            }
        }
        return null;
    }

    // Handle "New Note" action
    handleNewNote() {
        // Just open a blank notepad - don't save until user clicks Save
        this.createBlankNotepad();
    }

    // Show open note modal
    async showOpenNoteModal() {
        if (!this.openNoteModal || !this.openNoteList) {
            console.error('Open note modal not found');
            return;
        }

        try {
            const workspaceId = activeWorkspace || 'default';
            const response = await wsClient.getNotesByWorkspace(workspaceId);

            const notes = response?.notes || [];

            if (notes.length === 0) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('info', 'No notes found', 'No notes in this workspace', false, 3000, '<i class="fas fa-info-circle"></i>');
                }
                return;
            }

            // Populate note list
            this.openNoteList.innerHTML = notes.map(note => `
                <div class="note-selection-item" data-note-id="${note.id}" style="background: linear-gradient(135deg, color-mix(in srgb, ${note.color} 15%, var(--glass-layer-3)) 0%, var(--glass-layer-3) 100%);">
                    <i class="${this.escapeHtml(note.icon)}" style="color: ${note.color};"></i>
                    <span class="note-name">${this.escapeHtml(note.name)}</span>
                </div>
            `).join('');

            // Add click handlers
            this.openNoteList.querySelectorAll('.note-selection-item').forEach(item => {
                item.addEventListener('click', () => {
                    const noteId = item.getAttribute('data-note-id');
                    this.openExistingNote(noteId);
                    closeModal(this.openNoteModal);
                });
            });

            // Show modal
            openModal(this.openNoteModal);
        } catch (error) {
            console.error('Error loading notes:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to load notes', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    // Show update note modal
    showUpdateNoteModal(notepad) {
        if (!this.updateNoteModal) {
            console.error('Update note modal not found');
            return;
        }

        // Store reference to the notepad being updated
        this.currentNoteBeingUpdated = notepad;

        // Get form elements
        const nameInput = document.getElementById('noteUpdateName');
        const colorDropdown = document.getElementById('noteUpdateColorDropdown');
        const colorDropdownBtn = document.getElementById('noteUpdateColorDropdownBtn');
        const colorDropdownMenu = document.getElementById('noteUpdateColorDropdownMenu');
        const colorSelected = document.getElementById('noteUpdateColorSelected');
        const iconDropdown = document.getElementById('noteUpdateIconDropdown');
        const iconDropdownBtn = document.getElementById('noteUpdateIconDropdownBtn');
        const iconDropdownMenu = document.getElementById('noteUpdateIconDropdownMenu');
        const iconSelected = document.getElementById('noteUpdateIconSelected');
        const workspaceDropdown = document.getElementById('noteUpdateWorkspaceDropdown');
        const workspaceDropdownBtn = document.getElementById('noteUpdateWorkspaceDropdownBtn');
        const workspaceDropdownMenu = document.getElementById('noteUpdateWorkspaceDropdownMenu');
        const workspaceSelected = document.getElementById('noteUpdateWorkspaceSelected');

        // Set current values
        if (nameInput) {
            nameInput.value = notepad.note.name;
        }

        // Populate color dropdown
        if (colorDropdownMenu) {
            colorDropdownMenu.innerHTML = '';
            NOTE_PRESET_COLORS.forEach(preset => {
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option' + (preset.color === notepad.note.color ? ' selected' : '');
                option.dataset.value = preset.color;
                option.innerHTML = `
                    <div class="color-option-content">
                        <div class="color-square" style="background-color: ${preset.color}"></div>
                        <span>${preset.label}</span>
                    </div>
                `;
                
                option.addEventListener('click', () => {
                    colorSelected.innerHTML = `
                        <div class="color-option-content">
                            <div class="color-square" style="background-color: ${preset.color}"></div>
                            <span>${preset.label}</span>
                        </div>
                    `;
                    colorDropdownMenu.dataset.selectedColor = preset.color;
                    closeDropdown(colorDropdownMenu, colorDropdownBtn);
                });
                
                colorDropdownMenu.appendChild(option);
            });

            // Set initial selected display
            const currentColor = NOTE_PRESET_COLORS.find(p => p.color === notepad.note.color);
            if (currentColor && colorSelected) {
                colorSelected.innerHTML = `
                    <div class="color-option-content">
                        <div class="color-square" style="background-color: ${currentColor.color}"></div>
                        <span>${currentColor.label}</span>
                    </div>
                `;
                colorDropdownMenu.dataset.selectedColor = currentColor.color;
            }

            // Setup dropdown
            if (colorDropdown && colorDropdownBtn) {
                setupDropdown(
                    colorDropdown,
                    colorDropdownBtn,
                    colorDropdownMenu,
                    () => {}, // Already populated above
                    () => colorDropdownMenu.dataset.selectedColor || notepad.note.color,
                    { preventFocusTransfer: true }
                );
            }
        }

        // Populate icon dropdown
        if (iconDropdownMenu) {
            iconDropdownMenu.innerHTML = '';
            NOTE_PRESET_ICONS.forEach(preset => {
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option' + (preset.icon === notepad.note.icon ? ' selected' : '');
                option.dataset.value = preset.icon;
                option.innerHTML = `<i class="${preset.icon}"></i> ${preset.label}`;
                
                option.addEventListener('click', () => {
                    iconSelected.innerHTML = `<i class="${preset.icon}"></i> ${preset.label}`;
                    iconDropdownMenu.dataset.selectedIcon = preset.icon;
                    closeDropdown(iconDropdownMenu, iconDropdownBtn);
                });
                
                iconDropdownMenu.appendChild(option);
            });

            // Set initial selected display
            const currentIcon = NOTE_PRESET_ICONS.find(p => p.icon === notepad.note.icon);
            if (currentIcon && iconSelected) {
                iconSelected.innerHTML = `<i class="${currentIcon.icon}"></i> ${currentIcon.label}`;
                iconDropdownMenu.dataset.selectedIcon = currentIcon.icon;
            }

            // Setup dropdown
            if (iconDropdown && iconDropdownBtn) {
                setupDropdown(
                    iconDropdown,
                    iconDropdownBtn,
                    iconDropdownMenu,
                    () => {}, // Already populated above
                    () => iconDropdownMenu.dataset.selectedIcon || notepad.note.icon,
                    { preventFocusTransfer: true }
                );
            }
        }

        // Populate workspace dropdown
        if (workspaceDropdownMenu) {
            workspaceDropdownMenu.innerHTML = '';
            const workspacesData = workspaces || {};
            const workspacesList = Object.values(workspacesData).sort((a, b) => (a.sort || 0) - (b.sort || 0));

            workspacesList.forEach(ws => {
                const option = document.createElement('div');
                option.className = 'custom-dropdown-option' + (ws.id === notepad.note.workspace_id ? ' selected' : '');
                option.dataset.value = ws.id;
                
                option.innerHTML = `
                    <div class="workspace-option-content">
                        <div class="workspace-color-indicator" style="background-color: ${ws.color || '#102040'}"></div>
                        <span class="workspace-name">${ws.name}</span>
                    </div>
                `;
                
                option.addEventListener('click', () => {
                    const currentWorkspace = workspacesList.find(w => w.id === ws.id);
                    workspaceSelected.innerHTML = `
                        <div class="workspace-option-content">
                            <div class="workspace-color-indicator" style="background-color: ${ws.color || '#102040'}"></div>
                            <span class="workspace-name">${ws.name}</span>
                        </div>
                    `;
                    workspaceDropdownMenu.dataset.selectedWorkspace = ws.id;
                    closeDropdown(workspaceDropdownMenu, workspaceDropdownBtn);
                });
                
                workspaceDropdownMenu.appendChild(option);
            });

            // Set initial selected display
            const currentWorkspace = workspacesList.find(w => w.id === notepad.note.workspace_id);
            if (currentWorkspace && workspaceSelected) {
                workspaceSelected.innerHTML = `
                    <div class="workspace-option-content">
                        <div class="workspace-color-indicator" style="background-color: ${currentWorkspace.color || '#102040'}"></div>
                        <span class="workspace-name">${currentWorkspace.name}</span>
                    </div>
                `;
                workspaceDropdownMenu.dataset.selectedWorkspace = currentWorkspace.id;
            }

            // Setup dropdown
            if (workspaceDropdown && workspaceDropdownBtn) {
                setupDropdown(
                    workspaceDropdown,
                    workspaceDropdownBtn,
                    workspaceDropdownMenu,
                    () => {}, // Already populated above
                    () => workspaceDropdownMenu.dataset.selectedWorkspace || notepad.note.workspace_id,
                    { preventFocusTransfer: true }
                );
            }
        }

        // Show modal
        openModal(this.updateNoteModal);
    }

    // Handle save update note
    async handleSaveUpdateNote() {
        if (!this.currentNoteBeingUpdated) {
            console.error('No note being updated');
            return;
        }

        try {
            const nameInput = document.getElementById('noteUpdateName');
            const iconDropdownMenu = document.getElementById('noteUpdateIconDropdownMenu');
            const colorDropdownMenu = document.getElementById('noteUpdateColorDropdownMenu');
            const workspaceDropdownMenu = document.getElementById('noteUpdateWorkspaceDropdownMenu');

            const name = nameInput?.value;
            const icon = iconDropdownMenu?.dataset.selectedIcon;
            const color = colorDropdownMenu?.dataset.selectedColor;
            const workspaceId = workspaceDropdownMenu?.dataset.selectedWorkspace;

            if (!name) {
                if (typeof showGlassToast === 'function') {
                    showGlassToast('warning', 'Name required', 'Please enter a note name', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                }
                return;
            }

            await this.currentNoteBeingUpdated.updateNote({ 
                name, 
                icon, 
                color, 
                workspace_id: workspaceId 
            });

            closeModal(this.updateNoteModal);
        } catch (error) {
            console.error('Error saving note update:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to update note', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    // Escape HTML helper
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Generate UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ==================== NOTEBOOK METHODS ====================
    
    // Initialize notebook modal
    initializeNotebook() {
        this.notebookModal = document.getElementById('notebookModal');
        this.notebookNotesList = document.querySelector('.notebook-notes-list');
        this.notebookTextarea = document.getElementById('notebookTextarea');
        this.notebookTitleElement = document.getElementById('notebookCurrentNoteTitle');

        if (!this.notebookModal || !this.notebookNotesList || !this.notebookTextarea) {
            console.warn('Notebook modal elements not found');
            return;
        }

        // Setup event listeners
        const closeBtn = document.getElementById('closeNotebookBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeNotebook();
            });
        }

        const newNoteBtn = document.getElementById('notebookNewNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.addEventListener('click', async () => {
                await this.notebookHandleNewNote();
            });
        }

        const saveBtn = document.getElementById('notebookSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this.notebookSaveCurrentNote();
            });
        }

        // Textarea input
        if (this.notebookTextarea) {
            this.notebookTextarea.addEventListener('input', () => {
                this.notebookMarkAsUnsaved();
                // Only debounce save if note already exists (has an ID)
                if (this.notebookCurrentNote && this.notebookCurrentNote.id) {
                    this.notebookDebounceSave();
                }
            });
        }

        // Add button to open notebook
        const openNotebookBtn = document.getElementById('openNotebookBtn');
        if (openNotebookBtn) {
            openNotebookBtn.addEventListener('click', () => {
                this.openNotebook();
            });
        }

        // Listen for workspace changes to refresh list if open
        document.addEventListener('workspaceChanged', () => {
            if (this.notebookModal && !this.notebookModal.classList.contains('hidden')) {
                this.notebookRefreshNotesList();
            }
        });
    }

    // Open notebook modal
    async openNotebook() {
        if (!this.notebookModal) {
            console.error('Notebook modal not initialized');
            return;
        }
        await this.notebookRefreshNotesList();
        this.notebookUpdateSaveButton();
        openModal(this.notebookModal);
    }

    // Close notebook modal
    async closeNotebook() {
        const shouldContinue = await this.checkUnsavedChanges(
            this.notebookHasUnsavedChanges,
            () => this.notebookSaveCurrentNote()
        );
        
        if (!shouldContinue) return;

        closeModal(this.notebookModal);
        this.notebookCurrentNote = null;
        this.notebookTextarea.value = '';
        this.notebookHasUnsavedChanges = false;
        this.notebookUpdateTitle();
        this.notebookUpdateSaveButton();
    }

    // Refresh notes list in notebook
    async notebookRefreshNotesList() {
        try {
            const notes = await this.getNotesByWorkspace();
            this.notebookRenderNotesList(notes);
        } catch (error) {
            console.error('Error loading notes:', error);
            this.showToast('error', 'Failed to load notes', error.message);
        }
    }

    // Render notes list
    notebookRenderNotesList(notes) {
        if (!this.notebookNotesList) return;

        if (notes.length === 0) {
            this.notebookNotesList.innerHTML = `
                <div class="notebook-empty-state">
                    <i class="fas fa-file-lines"></i>
                    <p>No notes yet</p>
                    <p style="font-size: 0.9em;">Click "New Note" to create one</p>
                </div>
            `;
            return;
        }

        this.notebookNotesList.innerHTML = notes.map(note => `
            <div class="notebook-note-item ${this.notebookCurrentNote?.id === note.id ? 'active' : ''}" 
                data-note-id="${note.id}"
                data-note-name="${this.escapeHtml(note.name)}"
                data-note-icon="${this.escapeHtml(note.icon)}"
                data-note-color="${note.color || '#ffc107'}">
                <i class="${this.escapeHtml(note.icon)}" style="color: ${note.color || '#ffc107'}"></i>
                <span class="note-name">${this.escapeHtml(note.name)}</span>
            </div>
        `).join('');

        this.notebookNotesList.querySelectorAll('.notebook-note-item').forEach(item => {
            const noteId = item.getAttribute('data-note-id');
            const noteName = item.getAttribute('data-note-name');
            const noteIcon = item.getAttribute('data-note-icon');
            const noteColor = item.getAttribute('data-note-color');
            
            // Click handler
            item.addEventListener('click', () => {
                this.notebookLoadNote(noteId);
            });
            
            // Add context menu
            this.attachNotebookNoteContextMenu(item, { id: noteId, name: noteName, icon: noteIcon, color: noteColor });
        });
    }

    // Attach context menu to notebook note item
    attachNotebookNoteContextMenu(element, noteData) {
        if (!window.contextMenu) {
            console.warn('Context menu not available');
            return;
        }

        const contextMenuConfig = {
            sections: [
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-window',
                            text: 'Open in Window',
                            action: 'open-in-window'
                        },
                        {
                            icon: 'fas fa-arrow-down-left',
                            text: 'Add to Desktop',
                            action: 'add-to-desktop'
                        },
                        {
                            icon: 'fas fa-cog',
                            text: 'Modify Note',
                            action: 'modify-note'
                        },
                        {
                            separator: true
                        },
                        {
                            icon: 'fas fa-trash',
                            text: 'Delete Note',
                            action: 'delete-note',
                            className: 'context-menu-item-danger'
                        }
                    ]
                }
            ],
            onAction: async (action) => {
                switch (action) {
                    case 'open-in-window':
                        await this.notebookOpenInWindow(noteData.id);
                        break;
                    case 'add-to-desktop':
                        await this.notebookAddToDesktop(noteData);
                        break;
                    case 'modify-note':
                        await this.notebookModifyNote(noteData.id);
                        break;
                    case 'delete-note':
                        await this.notebookDeleteNote(noteData.id);
                        break;
                }
            }
        };

        window.contextMenu.attachToElement(element, contextMenuConfig);
    }

    // Open note in standalone window
    async notebookOpenInWindow(noteId) {
        try {
            await this.openExistingNote(noteId);
        } catch (error) {
            console.error('Error opening note in window:', error);
            this.showToast('error', 'Failed to open note', error.message);
        }
    }

    // Add note to desktop
    async notebookAddToDesktop(noteData) {
        try {
            if (typeof desktopShortcuts === 'undefined') {
                throw new Error('Desktop shortcuts manager not available');
            }

            const shortcut = {
                name: noteData.name,
                type: 'note',
                data: {
                    noteId: noteData.id
                }
            };

            await desktopShortcuts.addShortcut(shortcut);
            this.showToast('success', 'Shortcut added', 'Added to desktop');
        } catch (error) {
            console.error('Error adding shortcut:', error);
            this.showToast('error', 'Failed to add shortcut', error.message);
        }
    }

    // Modify note (open update modal)
    async notebookModifyNote(noteId) {
        try {
            // Load the full note data
            const note = await this.loadNoteById(noteId);
            
            // Create a temporary notepad-like object for the update modal
            const tempNotepad = {
                note: note,
                updateNote: async (updates) => {
                    // Use the notepad manager's method to update
                    const response = await wsClient.updateNote(note.id, updates);
                    if (response && response.success) {
                        Object.assign(note, updates);
                        
                        // Update desktop shortcut if it exists
                        if (typeof desktopShortcuts !== 'undefined') {
                            await desktopShortcuts.updateNoteShortcuts(note.id);
                        }
                        
                        // Refresh the notebook list
                        await this.notebookRefreshNotesList();
                        
                        // If this is the current note, update the display
                        if (this.notebookCurrentNote && this.notebookCurrentNote.id === note.id) {
                            Object.assign(this.notebookCurrentNote, updates);
                            this.notebookUpdateTitle();
                        }
                        
                        this.showToast('success', 'Note updated', '');
                        return true;
                    }
                    throw new Error('Failed to update');
                }
            };
            
            this.showUpdateNoteModal(tempNotepad);
        } catch (error) {
            console.error('Error modifying note:', error);
            this.showToast('error', 'Failed to modify note', error.message);
        }
    }

    // Delete note
    async notebookDeleteNote(noteId) {
        try {
            const result = await showConfirmationDialog(
                'Are you sure you want to delete this note?',
                [
                    { text: 'Delete', value: 'delete', className: 'btn-danger' },
                    { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
                ]
            );

            if (result !== 'delete') return;

            const response = await wsClient.deleteNote(noteId);
            
            if (response && response.success) {
                // If we're viewing this note, clear it
                if (this.notebookCurrentNote && this.notebookCurrentNote.id === noteId) {
                    this.notebookCurrentNote = null;
                    this.notebookTextarea.value = '';
                    this.notebookHasUnsavedChanges = false;
                    this.notebookUpdateTitle();
                }
                
                // Refresh the list
                await this.notebookRefreshNotesList();
                this.showToast('success', 'Note deleted', '');
            } else {
                throw new Error('Failed to delete');
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            this.showToast('error', 'Failed to delete note', error.message);
        }
    }

    // Load a note in notebook
    async notebookLoadNote(noteId, checkUnsaved = true) {
        if (checkUnsaved) {
            const shouldContinue = await this.checkUnsavedChanges(
                this.notebookHasUnsavedChanges && this.notebookCurrentNote,
                () => this.notebookSaveCurrentNote()
            );
            if (!shouldContinue) return;
        }

        try {
            const note = await this.loadNoteById(noteId);
            this.notebookCurrentNote = note;
            this.notebookTextarea.value = note.content || '';
            this.notebookHasUnsavedChanges = false;
            this.notebookUpdateTitle();
            this.notebookUpdateSaveButton();
            await this.notebookRefreshNotesList(); // Re-render to update active state
        } catch (error) {
            console.error('Error loading note:', error);
            this.showToast('error', 'Failed to load note', error.message);
        }
    }

    // Handle new note in notebook - creates blank note locally without server
    async notebookHandleNewNote() {
        const shouldContinue = await this.checkUnsavedChanges(
            this.notebookHasUnsavedChanges && this.notebookCurrentNote,
            () => this.notebookSaveCurrentNote()
        );
        
        if (!shouldContinue) return;

        // Create a blank note locally (no server interaction)
        this.notebookCurrentNote = null;
        this.notebookTextarea.value = '';
        this.notebookHasUnsavedChanges = true;
        this.notebookUpdateTitle();
        this.notebookUpdateSaveButton();
    }

    // Save current note in notebook
    async notebookSaveCurrentNote() {
        try {
            if (this.notebookSaveDebounceTimer) {
                clearTimeout(this.notebookSaveDebounceTimer);
                this.notebookSaveDebounceTimer = null;
            }

            const content = this.notebookTextarea.value;

            // If note doesn't exist yet, create it first
            if (!this.notebookCurrentNote || !this.notebookCurrentNote.id) {
                const name = await showInputDialog('Enter note name:', 'Untitled', 'Note name...');
                if (!name) return;

                const note = await this.createNote(name, content);
                this.notebookCurrentNote = note;
                this.notebookHasUnsavedChanges = false;
                this.notebookUpdateTitle();
                this.notebookUpdateSaveButton();
                await this.notebookRefreshNotesList();
                this.showToast('success', 'Note saved', name);
            } else {
                // Update existing note
                const success = await this.saveNoteContentById(this.notebookCurrentNote.id, content);

                if (success) {
                    this.notebookCurrentNote.content = content;
                    this.notebookHasUnsavedChanges = false;
                    this.notebookUpdateTitle();
                    this.notebookUpdateSaveButton();
                    this.showToast('success', 'Note saved', '');
                } else {
                    throw new Error('Failed to save');
                }
            }
        } catch (error) {
            console.error('Error saving note:', error);
            this.showToast('error', 'Failed to save note', error.message);
        }
    }

    // Debounce save for notebook
    notebookDebounceSave() {
        if (this.notebookSaveDebounceTimer) {
            clearTimeout(this.notebookSaveDebounceTimer);
        }

        this.notebookSaveDebounceTimer = setTimeout(() => {
            this.notebookSaveCurrentNote();
        }, this.notebookSaveDebounceDelay);
    }

    // Mark notebook as having unsaved changes
    notebookMarkAsUnsaved() {
        if (!this.notebookHasUnsavedChanges) {
            this.notebookHasUnsavedChanges = true;
            this.notebookUpdateTitle();
            this.notebookUpdateSaveButton();
        }
    }

    // Update save button appearance based on unsaved state
    notebookUpdateSaveButton() {
        const saveBtn = document.getElementById('notebookSaveBtn');
        if (!saveBtn) return;

        if (this.notebookHasUnsavedChanges) {
            saveBtn.classList.remove('btn-secondary');
            saveBtn.classList.add('btn-primary');
        } else {
            saveBtn.classList.remove('btn-primary');
            saveBtn.classList.add('btn-secondary');
        }
    }

    // Update notebook title
    notebookUpdateTitle() {
        if (!this.notebookTitleElement) return;

        if (this.notebookCurrentNote) {
            const unsavedMarker = this.notebookHasUnsavedChanges ? ' *' : '';
            this.notebookTitleElement.textContent = `Notebook [${this.notebookCurrentNote.name}]${unsavedMarker}`;
        } else {
            // Show "Notebook [Untitled] *" for new unsaved notes
            const title = this.notebookHasUnsavedChanges ? 'Notebook [Untitled]*' : 'Notebook';
            this.notebookTitleElement.textContent = title;
        }
    }

    // ==================== SHARED UTILITY METHODS ====================
    
    /**
     * Check for unsaved changes and prompt user
     * @param {boolean} hasUnsaved - Whether there are unsaved changes
     * @param {Function} saveCallback - Function to call if user chooses to save
     * @returns {Promise<boolean>} - True if should continue, false if cancelled
     */
    async checkUnsavedChanges(hasUnsaved, saveCallback) {
        if (!hasUnsaved) return true;

        const result = await showConfirmationDialog(
            'Do you want to save changes before continuing?',
            [
                { text: 'Save', value: 'save', className: 'btn-primary' },
                { text: 'Discard', value: 'discard', className: 'btn-secondary' },
                { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
            ]
        );

        if (result === 'save') {
            await saveCallback();
            return true;
        } else if (result === 'cancel') {
            return false;
        }
        return true; // discard
    }

    /**
     * Create a new note
     * @param {string} name - Note name
     * @param {string} content - Initial content
     * @returns {Promise<Object>} - Created note object
     */
    async createNote(name, content = '') {
        const noteId = this.generateUUID();
        const workspaceId = activeWorkspace || 'default';

        const response = await wsClient.createNote({
            id: noteId,
            name: name,
            workspaceId: workspaceId,
            content: content,
            icon: 'fas fa-file-lines',
            color: '#ffc107'
        });

        if (response && response.success && response.note) {
            return response.note;
        }
        throw new Error('Failed to create note');
    }

    /**
     * Save note content
     * @param {string} noteId - Note ID
     * @param {string} content - Content to save
     * @returns {Promise<boolean>} - Success status
     */
    async saveNoteContentById(noteId, content) {
        const response = await wsClient.saveNoteContent(noteId, content);
        return response && response.success;
    }

    /**
     * Load a note by ID
     * @param {string} noteId - Note ID
     * @returns {Promise<Object>} - Note object
     */
    async loadNoteById(noteId) {
        const response = await wsClient.getNote(noteId);
        if (!response || !response.note) {
            throw new Error('Note not found');
        }
        return response.note;
    }

    /**
     * Get all notes for current workspace
     * @returns {Promise<Array>} - Array of notes
     */
    async getNotesByWorkspace() {
        const workspaceId = activeWorkspace || 'default';
        const response = await wsClient.getNotesByWorkspace(workspaceId);
        return response?.notes || [];
    }

    /**
     * Show toast notification
     * @param {string} type - 'success', 'error', 'warning', 'info'
     * @param {string} title - Toast title
     * @param {string} message - Toast message
     */
    showToast(type, title, message = '') {
        if (typeof showGlassToast === 'function') {
            const icons = {
                success: '<i class="fas fa-check"></i>',
                error: '<i class="fas fa-exclamation-triangle"></i>',
                warning: '<i class="fas fa-exclamation-triangle"></i>',
                info: '<i class="fas fa-info-circle"></i>'
            };
            const duration = type === 'error' ? 5000 : 3000;
            showGlassToast(type, title, message, false, duration, icons[type] || '');
        }
    }
}

class Notepad {
    constructor(id, element, note, manager) {
        this.id = id;
        this.element = element;
        this.note = note;
        this.manager = manager;
        this.hasUnsavedChanges = false;
        this.saveDebounceTimer = null;
        this.saveDebounceDelay = 2000; // 2 seconds

        this.init();
        this.setupEventListeners();
    }

    init() {
        // Set title with "Notepad [name]" format
        this.updateTitle();

        // Set content
        const textarea = this.element.querySelector(`#notepadTextarea_${this.id}`);
        if (textarea && this.note) {
            textarea.value = this.note.content || '';
        }

        // Initialize save button state
        this.updateSaveButton();

        // Open modal
        openModal(this.element);
    }

    updateTitle(unsaved = false) {
        const titleElement = this.element.querySelector(`#notepadTitle_${this.id}`);
        if (titleElement) {
            const name = this.note ? this.note.name : 'Untitled';
            const unsavedMarker = unsaved || !this.note ? ' *' : '';
            titleElement.textContent = `Notepad [${name}]${unsavedMarker}`;
        }
    }

    setupEventListeners() {
        const textarea = this.element.querySelector(`#notepadTextarea_${this.id}`);
        const saveBtn = this.element.querySelector(`#notepadSaveBtn_${this.id}`);
        const maximizeBtn = this.element.querySelector(`#notepadMaximizeBtn_${this.id}`);
        const closeBtn = this.element.querySelector('.close-btn');
        const dropdown = this.element.querySelector(`#notepadDropdown_${this.id}`);
        const dropdownBtn = this.element.querySelector(`#notepadDropdownBtn_${this.id}`);
        const dropdownMenu = this.element.querySelector(`#notepadDropdownMenu_${this.id}`);

        // Textarea input - mark as unsaved (but don't auto-save unsaved notes)
        if (textarea) {
            textarea.addEventListener('input', () => {
                this.markAsUnsaved();
                // Only debounce save if note already exists
                if (this.note && this.note.id) {
                    this.debounceSave(textarea.value);
                }
            });
        }

        // Save button click - immediate save
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (textarea) {
                    await this.saveNoteContent(textarea.value);
                }
            });
        }

        // Maximize button - open in notebook
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', async () => {
                await this.maximizeToNotebook();
            });
        }

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.close();
            });
        }

        // Setup dropdown using the global dropdown utility
        if (dropdown && dropdownBtn && dropdownMenu) {
            setupDropdown(
                dropdown,
                dropdownBtn,
                dropdownMenu,
                () => this.renderNotepadDropdown(),
                () => null, // No selected value needed for action menu
                { preventFocusTransfer: true }
            );
        }
    }

    renderNotepadDropdown() {
        const dropdownMenu = this.element.querySelector(`#notepadDropdownMenu_${this.id}`);
        const dropdownBtn = this.element.querySelector(`#notepadDropdownBtn_${this.id}`);
        if (!dropdownMenu) return;

        dropdownMenu.innerHTML = '';

        const options = [
            {
                icon: 'fas fa-plus-large',
                text: 'New',
                action: 'new'
            },
            {
                icon: 'fas fa-folder-open',
                text: 'Open',
                action: 'open'
            },
            {
                icon: 'fas fa-cog',
                text: 'Update',
                action: 'update',
                disabled: !this.note || !this.note.id
            },
            {
                separator: true
            },
            {
                icon: 'fas fa-arrow-down-left',
                text: 'Add to Desktop',
                action: 'add-shortcut',
                disabled: !this.note || !this.note.id
            }
        ];

        options.forEach(option => {
            if (option.separator) {
                const separator = document.createElement('div');
                separator.className = 'custom-dropdown-separator';
                dropdownMenu.appendChild(separator);
                return;
            }

            const optionElement = document.createElement('div');
            optionElement.className = 'custom-dropdown-option' + (option.disabled ? ' disabled' : '');
            optionElement.dataset.action = option.action;
            optionElement.innerHTML = `<i class="${option.icon}"></i> ${option.text}`;

            if (!option.disabled) {
                optionElement.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Close the dropdown
                    closeDropdown(dropdownMenu, dropdownBtn);

                    // Handle the action
                    switch (option.action) {
                        case 'new':
                            this.manager.handleNewNote();
                            break;
                        case 'open':
                            this.handleOpenNote();
                            break;
                        case 'update':
                            this.handleUpdateNote();
                            break;
                        case 'add-shortcut':
                            this.handleAddShortcut();
                            break;
                    }
                });
            }

            dropdownMenu.appendChild(optionElement);
        });
    }

    markAsUnsaved() {
        if (!this.hasUnsavedChanges) {
            this.hasUnsavedChanges = true;
            this.updateTitle(true);
            this.updateSaveButton();
        }
    }

    markAsSaved() {
        this.hasUnsavedChanges = false;
        this.updateTitle(false);
        this.updateSaveButton();
    }

    // Update save button appearance based on unsaved state
    updateSaveButton() {
        const saveBtn = this.element.querySelector(`#notepadSaveBtn_${this.id}`);
        if (!saveBtn) return;

        if (this.hasUnsavedChanges) {
            saveBtn.classList.remove('btn-secondary');
            saveBtn.classList.add('btn-primary');
        } else {
            saveBtn.classList.remove('btn-primary');
            saveBtn.classList.add('btn-secondary');
        }
    }

    debounceSave(content) {
        // Clear existing timer
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }

        // Set new timer
        this.saveDebounceTimer = setTimeout(() => {
            this.saveNoteContent(content);
        }, this.saveDebounceDelay);
    }

    async saveNoteContent(content) {
        try {
            // Clear debounce timer if exists
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
                this.saveDebounceTimer = null;
            }

            // If note doesn't exist yet, create it first
            if (!this.note || !this.note.id) {
                // Prompt for name using input dialog
                const name = await showInputDialog('Enter note name:', 'Untitled', 'Note name...');
                if (!name) {
                    return; // User cancelled
                }

                const noteId = this.manager.generateUUID();
                const targetWorkspace = this.manager.currentWorkspace || 'default';

                const response = await wsClient.createNote({
                    id: noteId,
                    name: name,
                    workspaceId: targetWorkspace,
                    content: content,
                    icon: 'fas fa-file-lines',
                    color: '#ffc107'
                });

                if (response && response.success && response.note) {
                    this.note = response.note;
                    this.markAsSaved();
                    this.updateTitle(false);
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('success', 'Note saved', name, false, 3000, '<i class="fas fa-save"></i>');
                    }
                } else {
                    throw new Error('Failed to create note');
                }
            } else {
                // Update existing note
                const response = await wsClient.saveNoteContent(this.note.id, content);

                if (response && response.success) {
                    this.markAsSaved();
                    this.note.content = content;
                } else {
                    throw new Error('Failed to save');
                }
            }
        } catch (error) {
            console.error('Error saving note content:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to save note', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async handleOpenNote() {
        this.manager.showOpenNoteModal();
    }

    handleUpdateNote() {
        this.manager.showUpdateNoteModal(this);
    }

    async updateNote(updates) {
        try {
            const response = await wsClient.updateNote(this.note.id, updates);

            if (response && response.success) {
                Object.assign(this.note, updates);
                this.updateTitle(this.hasUnsavedChanges);
                
                // Update desktop shortcut if it exists
                if (typeof desktopShortcuts !== 'undefined') {
                    await desktopShortcuts.updateNoteShortcuts(this.note.id);
                }
                
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', 'Note updated', '', false, 3000, '<i class="fas fa-check"></i>');
                }
            } else {
                throw new Error('Failed to update');
            }
        } catch (error) {
            console.error('Error updating note:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to update note', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async handleAddShortcut() {
        try {
            // Use the desktop shortcuts manager to add the shortcut
            if (typeof desktopShortcuts === 'undefined') {
                throw new Error('Desktop shortcuts manager not available');
            }

            const shortcut = {
                name: this.note.name,
                type: 'note',
                data: {
                    noteId: this.note.id
                }
            };

            // Add shortcut using the manager (handles local add + debounced save)
            await desktopShortcuts.addShortcut(shortcut);

            if (typeof showGlassToast === 'function') {
                showGlassToast('success', 'Shortcut added', 'Added to desktop', false, 3000, '<i class="fas fa-thumbtack"></i>');
            }
        } catch (error) {
            console.error('Error adding shortcut:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to add shortcut', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async maximizeToNotebook() {
        try {
            const textarea = this.element.querySelector(`#notepadTextarea_${this.id}`);
            const currentContent = textarea ? textarea.value : '';

            // Open the notebook
            await this.manager.openNotebook();

            // Transfer content to notebook
            if (this.note && this.note.id) {
                // If note has an ID, load it in the notebook
                await this.manager.notebookLoadNote(this.note.id, false);
                
                // If there are unsaved changes, transfer them
                if (this.hasUnsavedChanges && currentContent !== (this.note.content || '')) {
                    this.manager.notebookTextarea.value = currentContent;
                    this.manager.notebookHasUnsavedChanges = true;
                    this.manager.notebookUpdateTitle();
                    this.manager.notebookUpdateSaveButton();
                }
            } else {
                // For unsaved notes, create a new blank note in notebook with this content
                this.manager.notebookCurrentNote = null;
                this.manager.notebookTextarea.value = currentContent;
                this.manager.notebookHasUnsavedChanges = true;
                this.manager.notebookUpdateTitle();
                this.manager.notebookUpdateSaveButton();
            }

            // Close this notepad window (without prompting since we transferred content)
            closeModal(this.element).then(() => {
                this.manager.removeNotepad(this.id);
            });
        } catch (error) {
            console.error('Error maximizing to notebook:', error);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', 'Failed to open in notebook', error.message, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }

    async close() {
        const textarea = this.element.querySelector(`#notepadTextarea_${this.id}`);
        const hasContent = textarea && textarea.value.trim().length > 0;
        
        // Check for unsaved changes
        if (this.hasUnsavedChanges && hasContent) {
            // Ask user if they want to save using confirmation dialog
            const result = await showConfirmationDialog(
                'Do you want to save changes before closing?',
                [
                    { text: 'Save', value: 'save', className: 'btn-primary' },
                    { text: 'Discard', value: 'discard', className: 'btn-secondary' },
                    { text: 'Cancel', value: 'cancel', className: 'btn-secondary' }
                ]
            );

            if (result === 'save') {
                await this.saveNoteContent(textarea.value);
            } else if (result === 'cancel') {
                return; // Don't close
            }
            // 'discard' or null - continue to close without saving
        }

        // Close modal and wait for animation
        closeModal(this.element).then(() => {
            // Clear debounce timer
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
                this.saveDebounceTimer = null;
            }
            // Remove after animation
            this.manager.removeNotepad(this.id);
        });

    }

    handleNoteUpdated(data) {
        // Update local note data if updated by another client
        if (this.note && data.note) {
            Object.assign(this.note, data.note);
            this.updateTitle(this.hasUnsavedChanges);
        }
    }

    handleNoteDeleted() {
        if (this.note && this.note.id) {
            if (typeof showGlassToast === 'function') {
                showGlassToast('warning', 'Note deleted', 'This note was deleted', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            this.close();
        }
    }

    destroy() {
        closeModal(this.element);
        setTimeout(() => {
            if (this.element && this.element.parentNode) {
                this.element.remove();
            }
        }, 1000);
    }
}

// Initialize notepad manager
const notepadManager = new NotepadManager();

// Register WebSocket initialization step
wsClient.registerInitStep(19, 'Initializing notepad manager', async () => {
    notepadManager.init();
});

// Export for global access
window.notepadManager = notepadManager;
