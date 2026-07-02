// Explorer import routing — public/scripts/comp/vfsImportRouter.js

const vfsImportRouter = {
    async routeFilesToPath(vfsPath, files) {
        const parsed = this._parsePath(vfsPath);
        for (const file of files) {
            await this._routeOneFile(parsed, vfsPath, file);
        }
    },

    _parsePath(vfsPath) {
        const parts = (vfsPath || '/').split('/').filter(Boolean);
        if (parts[0] === 'Workspaces' && parts.length >= 3) {
            return { workspaceId: parts[1], systemFolder: parts[2] || null, isHome: parts.length === 2 };
        }
        return { workspaceId: null, systemFolder: null, isHome: parts.length === 0 };
    },

    async _routeOneFile(parsed, vfsPath, file) {
        const mime = file.type || 'application/octet-stream';
        const name = file.name || 'file';

        if (parsed.systemFolder === 'Pictures') {
            await this._importAsGeneration(parsed.workspaceId, file, false);
            return;
        }
        if (parsed.systemFolder === 'Scraps') {
            await this._importAsGeneration(parsed.workspaceId, file, true);
            return;
        }
        if (parsed.systemFolder === 'References') {
            await this._importToReferences(parsed.workspaceId, file, mime);
            return;
        }
        if (parsed.systemFolder === 'Notes') {
            await this._importToNotes(parsed.workspaceId, file, mime);
            return;
        }
        if (parsed.systemFolder === 'Desktop') {
            showGlassToast('warning', null, 'Drop shortcuts on the desktop surface instead.', false, 4000);
            return;
        }

        const base64 = await fileToBase64(file);
        await vfsClient.uploadFile(vfsPath, base64, name, mime);
    },

    async _importAsGeneration(workspaceId, file, asScrap) {
        const base64 = await fileToBase64(file);
        const batchInfo = { currentIndex: 0, totalCount: 1 };
        const resp = await wsClient.uploadWorkspaceImage(base64, workspaceId, file.name, batchInfo);
        if (resp.success && asScrap && resp.filename) {
            await wsClient.addScrap(workspaceId, resp.filename);
        }
        if (resp.success) {
            showGlassToast('success', null, asScrap ? 'Imported to Scraps' : 'Imported to Pictures', false, 3000);
            if (typeof loadGallery === 'function') loadGallery(true);
        }
    },

    async _importToReferences(workspaceId, file, mime) {
        const nameLower = (file.name || '').toLowerCase();
        if (file.type === 'application/json' || nameLower.includes('.naiv4vibe')) {
            await this._importVibeFile(workspaceId, file);
            return;
        }
        if (!mime.startsWith('image/')) {
            await this._fallbackToHome(workspaceId, file, 'References');
            return;
        }
        const choice = await this._showImportChoice('Import Reference', [
            { id: 'base', label: 'Base Image' },
            { id: 'precise', label: 'Precise Reference' },
            { id: 'file', label: 'File' }
        ]);
        if (choice === 'base') {
            await this._uploadReference(workspaceId, file, false);
        } else if (choice === 'precise') {
            await this._uploadReference(workspaceId, file, true);
        } else if (choice === 'file') {
            await this._fallbackToHome(workspaceId, file, 'References');
        }
    },

    async _importToNotes(workspaceId, file, mime) {
        const isText = mime.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(file.name || '');
        if (!isText) {
            await this._fallbackToHome(workspaceId, file, 'Notes');
            return;
        }
        const choice = await this._showImportChoice('Import Text File', [
            { id: 'note', label: 'Note' },
            { id: 'file', label: 'File' }
        ]);
        if (choice === 'note') {
            const text = await file.text();
            const noteName = (file.name || 'Note').replace(/\.[^.]+$/, '');
            if (notepadManager) {
                await notepadManager.createNote(noteName, text);
                showGlassToast('success', null, 'Created note from file', false, 3000);
            }
        } else if (choice === 'file') {
            await this._fallbackToHome(workspaceId, file, 'Notes');
        }
    },

    async _uploadReference(workspaceId, file, precise) {
        const base64 = await fileToBase64(file);
        const tags = precise ? ['characterOnly'] : [];
        await wsClient.uploadReference(base64, workspaceId, null, null, null, null, tags);
        showGlassToast('success', null, 'Reference imported', false, 3000);
    },

    async _importVibeFile(workspaceId, file) {
        const text = await file.text();
        let jsonData;
        try {
            jsonData = JSON.parse(text);
        } catch (_err) {
            showGlassToast('error', 'Import Failed', 'Invalid vibe JSON file', false, 5000);
            return;
        }
        await wsClient.sendMessage('import_vibe_bundle', { workspaceId, jsonData, filename: file.name });
        showGlassToast('success', null, 'Vibe imported', false, 3000);
    },

    async _fallbackToHome(workspaceId, file, folderName) {
        const base64 = await fileToBase64(file);
        const homePath = `/Workspaces/${workspaceId}/`;
        await vfsClient.uploadFile(homePath, base64, file.name, file.type);
        showGlassToast('warning', 'Moved to home folder',
            `This data format cannot be saved to the ${folderName} directory. File was placed in the workspace home folder.`,
            false, 6000);
    },

    _showImportChoice(title, options) {
        return new Promise((resolve) => {
            const modal = document.getElementById('vfsImportChoiceModal');
            if (!modal) {
                resolve(options[0]?.id);
                return;
            }
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                modal._vfsImportResolve = null;
                resolve(value);
            };
            modal._vfsImportResolve = finish;
            // attachModalListeners: public/scripts/comp/modalListenerScope.js
            attachModalListeners(modal, (signal) => {
                signal.addEventListener('abort', () => finish(null), { once: true });
            });
            const titleEl = document.getElementById('vfsImportChoiceTitle');
            const listEl = document.getElementById('vfsImportChoiceList');
            if (titleEl) titleEl.textContent = title;
            if (listEl) {
                listEl.innerHTML = '';
                options.forEach(opt => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn-secondary vfs-import-choice-btn';
                    btn.textContent = opt.label;
                    btn.addEventListener('click', () => {
                        finish(opt.id);
                        closeModal(modal);
                    });
                    listEl.appendChild(btn);
                });
            }
            const closeBtn = modal.querySelector('.close-btn');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    finish(null);
                    closeModal(modal);
                };
            }
            openModal(modal);
        });
    }
};
