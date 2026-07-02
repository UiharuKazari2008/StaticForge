// VFS /System open routing — public/scripts/comp/vfsSystemOpenRouter.js

const vfsSystemOpenRouter = {
    _textModal: null,
    _textContentEl: null,
    _textTitleEl: null,
    _textStatusEl: null,

    isSystemPath(navPath) {
        return (navPath || '').replace(/\/+$/, '').split('/').filter(Boolean)[0] === 'System';
    },

    canHandleItem(item, currentPath) {
        if (!item) return false;
        if (item.targetKind === 'system-file') return true;
        if (this.isSystemPath(currentPath) && item.targetKind === 'system-folder' && item.navPath) {
            return false;
        }
        return false;
    },

    async openItem(item) {
        if (!item || item.targetKind !== 'system-file') return false;

        const openTarget = item.openTarget || 'text';

        if (item.adminOnly && typeof serverManagement !== 'undefined' && !serverManagement.isAdminSession()) {
            showGlassToast('error', 'Access Denied', 'Admin access required', false, 5000, '<i class="fas fa-lock"></i>');
            return true;
        }

        switch (openTarget) {
            case 'editor':
                await this._openConfigEditor(item.configId);
                return true;
            case 'applet':
                await this._openApplet(item);
                return true;
            case 'dsap':
                await this._openDsap(item.dsapUrl);
                return true;
            case 'viewer':
                await this._openImage(item);
                return true;
            case 'info':
                await this._showInfo(item);
                return true;
            case 'download':
                await this._downloadFile(item);
                return true;
            case 'text':
            default:
                await this._openText(item);
                return true;
        }
    },

    async _openConfigEditor(configId) {
        // configEditorApplet — public/scripts/comp/configEditorApplet.js
        if (configEditorApplet) {
            await configEditorApplet.open();
            if (configId) {
                await configEditorApplet.selectNode(configId, []);
            }
            return;
        }
        const modal = document.getElementById('configEditorModal');
        if (modal) openModal(modal);
    },

    _resolveAppLauncher(launchId) {
        if (!launchId) return null;

        // findStartMenuLaunchableById: public/scripts/comp/modalUtils.js
        const fromMenu = findStartMenuLaunchableById(launchId);
        if (fromMenu) return fromMenu;

        // System /Applications opens desktop-only apps even off desktop shell
        const candidates = [];
        const push = (entry) => {
            if (!entry?.launchId || typeof entry.action !== 'function') return;
            candidates.push(entry);
        };

        startMenuLaunchables.forEach(push);
        // flattenToolsSubmenuItems, buildToolsSubmenuItems: public/scripts/comp/modalUtils.js
        flattenToolsSubmenuItems(buildToolsSubmenuItems()).forEach(push);
        // getDsapMenuEntries: public/scripts/comp/dsapRegistry.js
        getDsapMenuEntries().forEach(push);

        return candidates.find((entry) => entry.launchId === launchId) || null;
    },

    async _openApplet(item) {
        if (item.logSource && !item.appletId) {
            // logViewerApplet — public/scripts/comp/logViewerApplet.js
            if (logViewerApplet) {
                await logViewerApplet.open({ source: item.logSource });
            } else {
                const modal = document.getElementById('logViewerModal');
                if (modal) openModal(modal);
            }
            return;
        }

        const launchId = item.appletId;
        if (!launchId) return;

        const launcher = this._resolveAppLauncher(launchId);
        if (launcher?.action) {
            await launcher.action();
            return;
        }

        if (launchId === 'config-editor') {
            await this._openConfigEditor(item.configId || null);
        }
    },

    async _openDsap(url) {
        // openDsapInGrimoire — public/scripts/comp/dsapRegistry.js
        if (url && typeof openDsapInGrimoire === 'function') {
            openDsapInGrimoire(url);
        }
    },

    async _downloadFile(item) {
        const key = item.systemFileKey || item.targetId;
        try {
            const resp = await vfsClient.downloadSystemFile(key);
            if (resp?.downloadUrl) {
                const a = document.createElement('a');
                a.href = resp.downloadUrl;
                a.download = item.name || resp.filename || 'download';
                a.click();
                return;
            }
            showGlassToast('error', 'Download Failed', 'Could not get download URL', false, 4000);
        } catch (err) {
            showGlassToast('error', item.name, err.message || 'Download failed', false, 5000);
        }
    },

    async _openImage(item) {
        const key = item.systemFileKey || item.targetId;
        const resp = await vfsClient.readSystemFile(key);
        if (!resp || !resp.base64) {
            showGlassToast('error', 'Preview Failed', 'Could not load image', false, 4000);
            return;
        }
        const mime = resp.mimeType || item.mimeType || 'image/png';
        const src = `data:${mime};base64,${resp.base64}`;
        // openImageInViewer — public/scripts/comp/imageViewer.js
        openImageInViewer(src, item.name || resp.name || 'Image', { readOnly: true });
    },

    async _showInfo(item) {
        const key = item.systemFileKey || item.targetId;
        try {
            const resp = await vfsClient.readSystemFile(key);
            const message = resp?.message || `${item.name} (${this._formatBytes(item.size || resp?.size || 0)})`;
            showGlassToast('info', item.name, message, false, 6000, '<i class="fas fa-database"></i>');
        } catch (err) {
            showGlassToast('error', item.name, err.message || 'Failed to read file info', false, 5000);
        }
    },

    async _openText(item) {
        const key = item.systemFileKey || item.targetId;
        const resp = await vfsClient.readSystemFile(key);
        if (!resp || resp.kind !== 'text') {
            if (resp?.kind === 'info') {
                showGlassToast('info', item.name, resp.message, false, 6000);
                return;
            }
            throw new Error('Unexpected file type');
        }

        const syntax = item.syntax || resp.syntax || 'text';
        let displayText = resp.content || '';
        let validationNote = '';

        if (syntax === 'json') {
            try {
                const parsed = JSON.parse(displayText);
                displayText = JSON.stringify(parsed, null, 2);
            } catch (e) {
                validationNote = `JSON validation: ${e.message}`;
            }
        }

        this._ensureTextModal();
        if (this._textTitleEl) {
            this._textTitleEl.textContent = item.name || resp.name || 'System File';
        }
        if (this._textContentEl) {
            this._textContentEl.textContent = displayText;
        }
        if (this._textStatusEl) {
            const parts = ['Read-only'];
            if (resp.size) parts.push(this._formatBytes(resp.size));
            if (validationNote) parts.push(validationNote);
            this._textStatusEl.textContent = parts.join(' · ');
        }
        openModal(this._textModal);
        setTimeout(() => {
            if (typeof customScrollbar !== 'undefined' && customScrollbar.forceReinit) {
                const wrap = this._textModal?.querySelector('.log-viewer-body-scroll');
                if (wrap) customScrollbar.forceReinit(wrap);
            }
        }, 80);
    },

    _ensureTextModal() {
        if (this._textModal) return;

        const modal = document.createElement('div');
        modal.id = 'vfsSystemTextViewerModal';
        modal.className = 'modal resizeable-window hidden tool-window';
        modal.dataset.windowMinWidth = '420';
        modal.dataset.windowMinHeight = '280';
        modal.dataset.windowMaxWidth = '1200';
        modal.dataset.windowMaxHeight = '900';
        modal.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main">
                    <i class="fas fa-file-code"></i>
                    <span id="vfsSystemTextViewerTitle">System File</span>
                </div>
            </div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize">
                    <i class="fa-regular fa-window-minimize"></i>
                </button>
                <button type="button" id="vfsSystemTextViewerCloseBtn" class="btn-danger close-btn btn-small" title="Close">
                    <i class="fa-regular fa-xmark-large"></i>
                </button>
            </div>
            <div class="modal-content dark">
                <div class="modal-body log-viewer-body-scroll" style="padding: 0;">
                    <pre id="vfsSystemTextViewerContent" class="log-viewer-pre selectable"></pre>
                </div>
                <footer id="vfsSystemTextViewerStatus" class="naxt-status-bar log-viewer-status-bar" aria-live="polite">
                    <span class="log-viewer-lines-text">Read-only</span>
                </footer>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('#vfsSystemTextViewerCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => closeModal(modal));
        }

        this._textModal = modal;
        this._textTitleEl = modal.querySelector('#vfsSystemTextViewerTitle');
        this._textContentEl = modal.querySelector('#vfsSystemTextViewerContent');
        this._textStatusEl = modal.querySelector('#vfsSystemTextViewerStatus');
    },

    _formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
};
