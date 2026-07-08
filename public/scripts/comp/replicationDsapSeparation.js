/**
 * Replication separation DSAP panel — bootstrap upload + master bundle wizard.
 * Depends on: dsapSmfMarkup.js, websocket.js, confirmationDialog.js, contextMenu.js
 */

const REPLICATION_SEPARATION_PANEL_ID = 'replication-separation-panel';

const REPLICATION_SEP_TRANSFER_MODES = [
    { id: 'tape-stream-compressed', label: 'Tape Stream (Compressed)' },
    { id: 'tape-stream', label: 'Tape Stream' },
    { id: 'blocks', label: 'Blocks (slow)' }
];

const REPLICATION_SEP_BLOCKS_WARNING = 'Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.';

const REPLICATION_SEP_DEFAULT_CLONE_PROFILE = {
    wikiData: true,
    wikiMedia: false,
    autoComplete: true,
    workspaceImages: false,
    previewCache: true,
    imageMetadata: true,
    referenceBlobs: false,
    vfsUserFiles: false
};

const REPLICATION_SEP_CLONE_OPTIONS = [
    { key: 'workspaceImages', label: 'Workspace Images' },
    { key: 'previewCache', label: 'Preview Cache' },
    { key: 'imageMetadata', label: 'Image Metadata', hint: 'Auto-included with Preview Cache' },
    { key: 'referenceBlobs', label: 'Reference blobs' },
    { key: 'vfsUserFiles', label: 'VFS user files' },
    { key: 'wikiData', label: 'Wiki Data' },
    { key: 'wikiMedia', label: 'Wiki Media' },
    { key: 'autoComplete', label: 'AutoComplete Service' }
];

function replicationSepEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function replicationSepTransferLabel(modeId) {
    const found = REPLICATION_SEP_TRANSFER_MODES.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

function replicationSepBuildCloneGridHtml(profile, prefix) {
    const pfx = prefix || 'sepClone';
    const prof = { ...REPLICATION_SEP_DEFAULT_CLONE_PROFILE, ...(profile || {}) };
    return REPLICATION_SEP_CLONE_OPTIONS.map((opt) => {
        const checked = prof[opt.key] ? ' checked' : '';
        const hint = opt.hint ? `<span class="data-mgmt-repl-clone-hint"> (${replicationSepEscapeHtml(opt.hint)})</span>` : '';
        return `<label><input type="checkbox" data-${pfx}-key="${replicationSepEscapeHtml(opt.key)}"${checked} /> ${replicationSepEscapeHtml(opt.label)}${hint}</label>`;
    }).join('');
}

function replicationSepReadCloneGrid(root, prefix) {
    const pfx = prefix || 'sepClone';
    const profile = { ...REPLICATION_SEP_DEFAULT_CLONE_PROFILE };
    root.querySelectorAll(`input[data-${pfx}-key]`).forEach((input) => {
        const key = input.getAttribute(`data-${pfx}-key`);
        if (key) profile[key] = input.checked;
    });
    if (profile.previewCache && !profile.workspaceImages) {
        profile.imageMetadata = true;
    }
    return profile;
}

function replicationSepBuildBootstrapPanelHtml() {
    return `
<div data-dsap="${REPLICATION_SEPARATION_PANEL_ID}" class="dsap-root dsap-smf replication-sep-panel replication-sep-embedded">
    ${dsapSmfBuildSectionHdr('Upload separation bundle')}
    <div class="dsap-smf-toolbar">
        <button type="button" class="dsap-smf-btn" id="replicationSepPickManifest">Select manifest.json</button>
        <button type="button" class="dsap-smf-btn" id="replicationSepPickArchive">Select archive (.tar/.tar.zst)</button>
    </div>
    <input type="file" id="replicationSepManifestInput" accept=".json,application/json" class="hidden" />
    <input type="file" id="replicationSepArchiveInput" accept=".tar,.zst,application/x-tar,application/zstd" class="hidden" />
    <div id="replicationSepFileSummary" class="dsap-smf-status-box">No files selected.</div>
    ${dsapSmfBuildSectionHdr('Clone profile preview')}
    <div id="replicationSepPreview" class="dsap-smf-status-box">Upload manifest to preview.</div>
    ${dsapSmfBuildSectionHdr('Confirm bootstrap token')}
    <div class="replication-sep-token-row">
        <input type="password" id="replicationSepTokenInput" class="dsap-smf-input" placeholder="Token from manifest or master" autocomplete="off" />
        <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="replicationSepApplyBtn" disabled>Apply bundle</button>
    </div>
    <div id="replicationSepStatus" class="dsap-smf-status-box hidden"></div>
</div>`;
}

function replicationSepBuildBundleWizardHtml() {
    return `
<div class="replication-sep-bundle-wizard" data-replication-bundle-wizard="1">
    <p class="data-mgmt-repl-lead">Create a separation bundle on this master node. Maintenance mode locks writes until the archive is sealed.</p>
    <div class="data-mgmt-repl-dialog-field">
        <label for="replicationSepChildName">Child display name</label>
        <input type="text" id="replicationSepChildName" class="dsap-smf-input" placeholder="shore-laptop" />
    </div>
    <div class="data-mgmt-repl-dialog-field">
        <label>Transfer mode</label>
        <button type="button" class="dsap-smf-btn" id="replicationSepBundleTransferBtn">
            <span id="replicationSepBundleTransferLabel">${replicationSepEscapeHtml(replicationSepTransferLabel('tape-stream-compressed'))}</span>
            <i class="fas fa-caret-down"></i>
        </button>
    </div>
    <div class="data-mgmt-repl-dialog-field">
        <label>Clone profile</label>
        <div class="data-mgmt-repl-clone-grid">${replicationSepBuildCloneGridHtml(null, 'bundleClone')}</div>
    </div>
    <div class="dsap-smf-toolbar">
        <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="replicationSepBundleStartBtn">
            <i class="fas fa-box-open"></i> Prepare separation bundle
        </button>
    </div>
    <div id="replicationSepBundleStatus" class="dsap-smf-status-box hidden"></div>
    <div id="replicationSepBundleResult" class="data-mgmt-repl-download-links"></div>
</div>`;
}

function replicationSepGetPanelCss() {
    return `
[data-dsap="${REPLICATION_SEPARATION_PANEL_ID}"] .replication-sep-token-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
}
[data-dsap="${REPLICATION_SEPARATION_PANEL_ID}"] .dsap-smf-input,
.replication-sep-bundle-wizard .dsap-smf-input {
    flex: 1;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 1px solid #b8c4d0;
    font-size: 0.85rem;
}
[data-dsap="${REPLICATION_SEPARATION_PANEL_ID}"] .hidden,
.replication-sep-bundle-wizard .hidden {
    display: none !important;
}
[data-dsap="${REPLICATION_SEPARATION_PANEL_ID}"] pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
}
.replication-sep-bundle-wizard .data-mgmt-repl-lead {
    margin: 0 0 10px;
    font-size: 0.85rem;
    line-height: 1.45;
}`;
}

function replicationSepState() {
    if (!replicationSepState._state) {
        replicationSepState._state = {
            manifestFile: null,
            archiveFile: null,
            preview: null,
            wired: false,
            bundleTransferMode: 'tape-stream-compressed',
            bundleWired: false
        };
    }
    return replicationSepState._state;
}

function replicationSepUpdateSummary(root) {
    const state = replicationSepState();
    const el = root.querySelector('#replicationSepFileSummary');
    if (!el) return;
    const lines = [];
    lines.push(state.manifestFile ? `Manifest: ${state.manifestFile.name}` : 'Manifest: —');
    lines.push(state.archiveFile ? `Archive: ${state.archiveFile.name}` : 'Archive: —');
    el.textContent = lines.join(' · ');
    const applyBtn = root.querySelector('#replicationSepApplyBtn');
    if (applyBtn) {
        applyBtn.disabled = !(state.manifestFile && state.archiveFile && state.preview);
    }
}

function replicationSepRenderPreview(root, preview) {
    const el = root.querySelector('#replicationSepPreview');
    if (!el || !preview) return;
    const profile = preview.cloneProfile || {};
    const rows = Object.keys(profile).map((k) => `${k}: ${profile[k] ? 'yes' : 'no'}`).join('\n');
    el.innerHTML = `<pre>${replicationSepEscapeHtml(
        `Child: ${preview.childDisplayName || preview.childInstanceId || '—'}\n`
        + `Entries: ${preview.entryCount || 0} · ${preview.totalBytes || 0} bytes\n`
        + `Transfer: ${preview.transferMode || '—'}\n\n`
        + rows
    )}</pre>`;
}

function replicationSepShowStatus(root, kind, message, statusId) {
    const el = root.querySelector(statusId || '#replicationSepStatus');
    if (!el) return;
    el.classList.remove('hidden');
    el.className = `dsap-smf-status-box ${kind === 'error' ? 'dsap-smf-status-error' : ''}`;
    el.textContent = message;
}

async function replicationSepPreviewManifest(root) {
    const state = replicationSepState();
    if (!state.manifestFile) return;

    replicationSepShowStatus(root, 'info', 'Reading manifest...');
    const text = await state.manifestFile.text();
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch (e) {
        replicationSepShowStatus(root, 'error', 'Invalid manifest JSON');
        return;
    }

    state.preview = {
        manifestId: manifest.manifestId,
        childInstanceId: manifest.childInstanceId,
        childDisplayName: manifest.childDisplayName,
        cloneProfile: manifest.cloneProfile,
        transferMode: manifest.transferMode,
        entryCount: manifest.entryCount,
        totalBytes: manifest.totalBytes,
        requiresTokenConfirm: true
    };
    replicationSepRenderPreview(root, state.preview);
    replicationSepUpdateSummary(root);
    replicationSepShowStatus(root, 'info', 'Manifest loaded — enter token to apply.');
}

async function replicationSepApplyBundle(root) {
    const state = replicationSepState();
    if (!state.manifestFile || !state.archiveFile) return;

    const tokenInput = root.querySelector('#replicationSepTokenInput');
    const confirmToken = tokenInput ? tokenInput.value.trim() : '';
    if (!confirmToken) {
        replicationSepShowStatus(root, 'error', 'Bootstrap token required');
        return;
    }

    replicationSepShowStatus(root, 'info', 'Applying bundle (maintenance)...');

    try {
        if (wsClient && wsClient.isConnected()) {
            const manifestText = await state.manifestFile.text();
            const manifest = JSON.parse(manifestText);
            const archiveBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result;
                    const base64 = String(dataUrl).split(',')[1] || '';
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(state.archiveFile);
            });

            const response = await wsClient.sendMessage('replication_separation_bootstrap_apply', {
                manifest,
                archiveBase64,
                archiveName: state.archiveFile.name,
                confirmToken
            }, true);

            if (response && response.data && response.data.success) {
                replicationSepShowStatus(root, 'info', 'Bootstrap complete.');
            } else {
                replicationSepShowStatus(root, 'error', (response && response.error) || 'Bootstrap failed');
            }
            return;
        }

        replicationSepShowStatus(root, 'error', 'WebSocket not connected — use CLI bootstrap or connect first.');
    } catch (err) {
        console.error('[replication-separation] bootstrap apply failed:', err);
        replicationSepShowStatus(root, 'error', err.message || 'Bootstrap failed');
    }
}

function replicationSepPollJob(jobId) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const poll = async () => {
            attempts += 1;
            if (!wsClient?.isConnected()) {
                reject(new Error('WebSocket disconnected'));
                return;
            }
            try {
                const response = await wsClient.sendMessage('replication_separation_status', { jobId }, true);
                const job = response?.data?.job || response?.job;
                if (!job) {
                    reject(new Error('Separation job not found'));
                    return;
                }
                if (job.status === 'complete') {
                    resolve(job);
                    return;
                }
                if (job.status === 'error') {
                    reject(new Error(job.error || 'Separation failed'));
                    return;
                }
                if (attempts > 600) {
                    reject(new Error('Separation timed out'));
                    return;
                }
                setTimeout(poll, 1000);
            } catch (err) {
                reject(err);
            }
        };
        poll();
    });
}

function replicationSepWireTransferMenu(btn, labelEl, getMode, setMode) {
    if (!btn || !contextMenu) return;
    const items = REPLICATION_SEP_TRANSFER_MODES.map((mode) => ({
        text: mode.label,
        action: () => {
            if (mode.id === 'blocks') {
                // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
                showConfirmationDialog(
                    'Blocks transfer mode',
                    REPLICATION_SEP_BLOCKS_WARNING,
                    () => {
                        setMode(mode.id);
                        if (labelEl) labelEl.textContent = mode.label;
                    },
                    null,
                    { confirmText: 'Use Blocks', cancelText: 'Cancel' }
                );
                return;
            }
            setMode(mode.id);
            if (labelEl) labelEl.textContent = mode.label;
        }
    }));
    contextMenu.attachClickMenuToElement(btn, items);
}

async function replicationSepStartBundle(root, host) {
    const nameInput = root.querySelector('#replicationSepChildName');
    const childDisplayName = nameInput ? nameInput.value.trim() : '';
    if (!childDisplayName) {
        replicationSepShowStatus(root, 'error', 'Child display name required', '#replicationSepBundleStatus');
        if (host?.showToast) host.showToast('error', 'Child display name required');
        return;
    }

    const state = replicationSepState();
    const cloneProfile = replicationSepReadCloneGrid(root, 'bundleClone');
    const body = { childDisplayName, cloneProfile, transferMode: state.bundleTransferMode };
    if (state.bundleTransferMode === 'blocks') body.blocksAck = REPLICATION_SEP_BLOCKS_WARNING;

    const startBtn = root.querySelector('#replicationSepBundleStartBtn');
    if (startBtn) startBtn.disabled = true;
    replicationSepShowStatus(root, 'info', 'Separation running — writes locked', '#replicationSepBundleStatus');

    try {
        const response = await wsClient.sendMessage('replication_separation_prepare', body, true);
        const jobId = response?.data?.jobId || response?.jobId;
        if (!jobId) throw new Error('No job ID returned');
        if (host?.showToast) host.showToast('info', 'Separation running — writes locked');
        const job = await replicationSepPollJob(jobId);
        const result = job.result || {};
        const manifestId = result.manifestId;
        const resultEl = root.querySelector('#replicationSepBundleResult');
        if (resultEl && manifestId) {
            resultEl.innerHTML = `
                <p>Bundle sealed for <strong>${replicationSepEscapeHtml(childDisplayName)}</strong>.</p>
                <a href="/replication/separation/download/${replicationSepEscapeHtml(manifestId)}" download>Download archive</a>
                <a href="/replication/separation/manifest/${replicationSepEscapeHtml(manifestId)}" target="_blank" rel="noopener">View manifest</a>
                <p class="data-mgmt-muted">Transfer the archive and manifest to the child, then bootstrap on the child node.</p>`;
        }
        replicationSepShowStatus(root, 'info', 'Separation bundle ready', '#replicationSepBundleStatus');
        if (host?.showToast) host.showToast('success', 'Separation bundle ready');
    } catch (err) {
        console.error('[replication-separation] bundle prepare failed:', err);
        replicationSepShowStatus(root, 'error', err.message || 'Separation failed', '#replicationSepBundleStatus');
        if (host?.showToast) host.showToast('error', err.message || 'Separation failed');
    } finally {
        if (startBtn) startBtn.disabled = false;
    }
}

function replicationSepWireBootstrapPanel(root) {
    const state = replicationSepState();
    if (state.wired) return;
    state.wired = true;

    const manifestInput = root.querySelector('#replicationSepManifestInput');
    const archiveInput = root.querySelector('#replicationSepArchiveInput');
    const pickManifest = root.querySelector('#replicationSepPickManifest');
    const pickArchive = root.querySelector('#replicationSepPickArchive');
    const applyBtn = root.querySelector('#replicationSepApplyBtn');

    if (pickManifest && manifestInput) {
        pickManifest.addEventListener('click', () => manifestInput.click());
        manifestInput.addEventListener('change', () => {
            state.manifestFile = manifestInput.files && manifestInput.files[0] ? manifestInput.files[0] : null;
            replicationSepUpdateSummary(root);
            if (state.manifestFile) replicationSepPreviewManifest(root);
        });
    }

    if (pickArchive && archiveInput) {
        pickArchive.addEventListener('click', () => archiveInput.click());
        archiveInput.addEventListener('change', () => {
            state.archiveFile = archiveInput.files && archiveInput.files[0] ? archiveInput.files[0] : null;
            replicationSepUpdateSummary(root);
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', () => replicationSepApplyBundle(root));
    }
}

function replicationSepWireBundleWizard(root, host) {
    const state = replicationSepState();
    if (state.bundleWired) return;
    state.bundleWired = true;

    const transferBtn = root.querySelector('#replicationSepBundleTransferBtn');
    const transferLabel = root.querySelector('#replicationSepBundleTransferLabel');
    replicationSepWireTransferMenu(
        transferBtn,
        transferLabel,
        () => state.bundleTransferMode,
        (id) => { state.bundleTransferMode = id; }
    );

    const startBtn = root.querySelector('#replicationSepBundleStartBtn');
    if (startBtn) {
        startBtn.addEventListener('click', () => replicationSepStartBundle(root, host));
    }
}

function replicationSepInitBootstrapPanel(host) {
    const root = host && host.getRoot ? host.getRoot() : document.querySelector(`[data-dsap="${REPLICATION_SEPARATION_PANEL_ID}"]`);
    if (!root) return;
    setTimeout(() => replicationSepWireBootstrapPanel(root), 0);
}

function replicationSepInitPanel(host) {
    replicationSepInitBootstrapPanel(host);
}

function replicationSepInitBundleWizard(root, host) {
    if (!root) return;
    setTimeout(() => replicationSepWireBundleWizard(root, host), 0);
}

function replicationSepDestroyPanel() {
    const state = replicationSepState();
    const transferBtn = document.querySelector('#replicationSepBundleTransferBtn');
    if (transferBtn && typeof contextMenu !== 'undefined') {
        contextMenu.detachClickMenuFromElement(transferBtn);
    }
    state.manifestFile = null;
    state.archiveFile = null;
    state.preview = null;
    state.wired = false;
    state.bundleWired = false;
}

function replicationSepGetPanelContent() {
    return {
        html: replicationSepBuildBootstrapPanelHtml(),
        css: replicationSepGetPanelCss(),
        drivers: {
            init: replicationSepInitBootstrapPanel,
            destroy: replicationSepDestroyPanel,
            refresh: replicationSepInitBootstrapPanel
        }
    };
}
