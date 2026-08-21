/**
 * Replication cargo DSAP panel — upsert page + manual export/import.
 * Depends on: dsapSmfMarkup.js, confirmationDialog.js, contextMenu.js
 */

const REPLICATION_CARGO_TRANSFER_MODES = [
    { id: 'tape-stream-compressed', label: 'Tape Stream (Compressed)' },
    { id: 'tape-stream', label: 'Tape Stream' },
    { id: 'blocks', label: 'Blocks (slow)' }
];

const REPLICATION_CARGO_BLOCKS_WARNING = 'Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.';

let replicationCargoPanelState = {
    transferMode: 'tape-stream-compressed',
    overrideMode: null,
    lastManifestId: null,
    lastResponseUrl: null,
    statusText: 'Idle',
    defaultTransferMode: 'tape-stream-compressed'
};

function replicationCargoRevokeLastResponseUrl() {
    if (replicationCargoPanelState.lastResponseUrl) {
        URL.revokeObjectURL(replicationCargoPanelState.lastResponseUrl);
        replicationCargoPanelState.lastResponseUrl = null;
    }
}

function replicationCargoEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function replicationCargoGetEffectiveMode() {
    return replicationCargoPanelState.overrideMode || replicationCargoPanelState.transferMode;
}

function replicationCargoGetSelectedModeLabel() {
    const mode = replicationCargoGetEffectiveMode();
    const found = REPLICATION_CARGO_TRANSFER_MODES.find((m) => m.id === mode);
    return found ? found.label : mode;
}

async function replicationCargoFetchStatus() {
    const res = await fetch('/replication/status', { credentials: 'same-origin' });
    if (!res.ok) {
        const err = new Error(`Status HTTP ${res.status}`);
        console.error('[replication-cargo] fetch /replication/status failed:', err.message);
        throw err;
    }
    const json = await res.json();
    return json.data || json;
}

async function replicationCargoPost(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
        const err = new Error(json.error || `HTTP ${res.status}`);
        err.code = json.code;
        err.confirmationRequired = json.confirmationRequired;
        console.error('[replication-cargo] POST', path, 'failed:', err.message);
        throw err;
    }
    return json.data;
}

function replicationCargoSetStatus(root, text) {
    replicationCargoPanelState.statusText = text;
    const el = root.querySelector('#replicationCargoStatusMessage');
    if (el) el.textContent = text;
}

function replicationCargoWireModePicker(root, host, btnId, labelId, isOverride) {
    const btn = root.querySelector(btnId || '#replicationCargoModeBtn');
    if (!btn || typeof contextMenu === 'undefined') return;

    const items = REPLICATION_CARGO_TRANSFER_MODES.map((mode) => ({
        text: mode.label,
        action: () => {
            if (mode.id === 'blocks') {
                // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
                showConfirmationDialog(
                    'Blocks transfer mode',
                    REPLICATION_CARGO_BLOCKS_WARNING,
                    () => {
                        if (isOverride) {
                            replicationCargoPanelState.overrideMode = mode.id;
                        } else {
                            replicationCargoPanelState.transferMode = mode.id;
                        }
                        const label = root.querySelector(labelId || '#replicationCargoModeLabel');
                        if (label) label.textContent = mode.label;
                    },
                    null,
                    { confirmText: 'Use Blocks', cancelText: 'Cancel' }
                );
                return;
            }
            if (isOverride) {
                replicationCargoPanelState.overrideMode = mode.id;
            } else {
                replicationCargoPanelState.transferMode = mode.id;
            }
            const label = root.querySelector(labelId || '#replicationCargoModeLabel');
            if (label) label.textContent = mode.label;
        }
    }));

    contextMenu.attachClickMenuToElement(btn, items);
}

function replicationCargoDefaultModeLabel(modeId) {
    const found = REPLICATION_CARGO_TRANSFER_MODES.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

function replicationCargoBuildUpsertPageHtml() {
    const defaultLabel = replicationCargoEscapeHtml(replicationCargoDefaultModeLabel(replicationCargoPanelState.defaultTransferMode));
    const overrideLabel = replicationCargoEscapeHtml(replicationCargoGetSelectedModeLabel());
    return `
        <div class="replication-cargo-panel" data-replication-cargo-panel="1">
            ${dsapSmfBuildSectionHdr('Upsert Cargo')}
            <table class="dsap-smf-stats-table" id="replicationCargoStatsTable">
                <tbody>
                    <tr>
                        <td class="dsap-smf-stats-label">Default mode</td>
                        <td id="replicationCargoDefaultMode">${defaultLabel}</td>
                        <td class="dsap-smf-stats-label">This operation</td>
                        <td>
                            <button type="button" class="dsap-smf-btn" id="replicationCargoModeBtn">
                                <span id="replicationCargoModeLabel">${overrideLabel}</span>
                                <i class="fas fa-caret-down"></i>
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <td class="dsap-smf-stats-label">Maintenance</td>
                        <td id="replicationCargoMaintenance" colspan="3">—</td>
                    </tr>
                </tbody>
            </table>
            ${dsapSmfBuildStatusBox('<span id="replicationCargoStatusMessage">Idle</span>', 'replicationCargoStatusBox', 'replicationCargoStatusMessage')}
            <div class="dsap-smf-toolbar replication-cargo-toolbar">
                <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="replicationCargoUpsertBtn">
                    <i class="fas fa-cloud-upload-alt"></i> Upsert to master
                </button>
            </div>
            ${dsapSmfBuildSectionHdr('Manual transfer')}
            <div class="dsap-smf-toolbar replication-cargo-toolbar">
                <button type="button" class="dsap-smf-btn" id="replicationCargoExportBtn">
                    <i class="fas fa-file-export"></i> Export cargo
                </button>
                <button type="button" class="dsap-smf-btn" id="replicationCargoImportBtn">
                    <i class="fas fa-file-import"></i> Import cargo
                </button>
            </div>
            <input type="file" id="replicationCargoFileInput" class="hidden" accept=".tar,.zst,.json,application/octet-stream">
            <div class="replication-cargo-meta" id="replicationCargoMeta"></div>
            <div id="replicationCargoProgressHost" class="data-mgmt-repl-progress-host hidden"></div>
        </div>
    `;
}

function replicationCargoRenderProgress(root) {
    const host = root.querySelector('#replicationCargoProgressHost');
    if (!host || typeof replicationDsapBuildProgressHtml !== 'function') return;
    const snap = typeof replicationDsapGetLiveProgress === 'function'
        ? replicationDsapGetLiveProgress()
        : null;
    if (!snap || !snap.active) {
        host.classList.add('hidden');
        host.innerHTML = '';
        return;
    }
    host.classList.remove('hidden');
    host.innerHTML = replicationDsapBuildProgressHtml(snap);
}

async function replicationCargoRefreshStatus(root, host) {
    try {
        const status = await replicationCargoFetchStatus();
        const defaultEl = root.querySelector('#replicationCargoDefaultMode');
        const maintEl = root.querySelector('#replicationCargoMaintenance');
        if (status.transferMode) {
            replicationCargoPanelState.defaultTransferMode = status.transferMode;
            if (!replicationCargoPanelState.overrideMode) {
                replicationCargoPanelState.transferMode = status.transferMode;
            }
        }
        if (defaultEl) {
            defaultEl.textContent = replicationCargoDefaultModeLabel(status.transferMode || 'tape-stream-compressed');
        }
        if (maintEl) {
            maintEl.textContent = status.maintenance?.active
                ? `${status.maintenance.operation || 'active'}`
                : 'off';
        }

        const upsertBtn = root.querySelector('#replicationCargoUpsertBtn');
        const airgapped = status.connectivity === 'airgapped';
        if (upsertBtn) {
            const wrongRole = status.role !== 'child' && status.role !== 'ephemeral';
            const disabled = airgapped || wrongRole || status.maintenance?.active;
            upsertBtn.disabled = disabled;
            if (airgapped) upsertBtn.title = 'Upsert disabled in airgapped mode — use Export cargo';
            else if (wrongRole) upsertBtn.title = 'Upsert requires child or ephemeral role';
            else if (status.maintenance?.active) upsertBtn.title = 'Replication operation in progress';
            else upsertBtn.title = '';
        }

        const importBtn = root.querySelector('#replicationCargoImportBtn');
        if (importBtn) {
            const disabled = status.role !== 'master';
            importBtn.disabled = disabled;
            importBtn.title = disabled ? 'Import requires master role' : '';
        }

        replicationCargoSetStatus(root, replicationCargoPanelState.statusText);
        replicationCargoRenderProgress(root);

        if (status.maintenance?.active && host?.navigate) {
            host.navigate('dsap://data.dreamscape.jp/replication/progress');
        }
    } catch (err) {
        replicationCargoSetStatus(root, `Status error: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

async function replicationCargoHandleExport(root, host) {
    replicationCargoSetStatus(root, 'Exporting cargo…');
    try {
        const mode = replicationCargoGetEffectiveMode();
        const body = { transferMode: mode };
        if (mode === 'blocks') body.blocksAck = REPLICATION_CARGO_BLOCKS_WARNING;
        const data = await replicationCargoPost('/replication/cargo/export', body);
        replicationCargoPanelState.lastManifestId = data.manifestId;
        const meta = root.querySelector('#replicationCargoMeta');
        if (meta) {
            meta.innerHTML = `
                <p>Manifest <code>${replicationCargoEscapeHtml(data.manifestId)}</code></p>
                <p><a href="${replicationCargoEscapeHtml(data.streamUrl)}" download>Download cargo stream</a></p>
            `;
        }
        replicationCargoSetStatus(root, `Export ready (${data.manifest?.entries?.length || 0} entries)`);
        if (host && host.showToast) host.showToast('success', 'Cargo export ready');
    } catch (err) {
        replicationCargoSetStatus(root, `Export failed: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

async function replicationCargoUploadFile(root, host, file) {
    replicationCargoSetStatus(root, 'Preparing import…');
    const mode = replicationCargoGetEffectiveMode();
    const body = { transferMode: mode, operation: 'import' };
    if (mode === 'blocks') body.blocksAck = REPLICATION_CARGO_BLOCKS_WARNING;
    const begin = await replicationCargoPost('/replication/cargo/import/begin', body);
    const manifestId = begin.manifestId;

    const chunkSize = 512 * 1024;
    let offset = 0;
    while (offset < file.size) {
        const slice = file.slice(offset, offset + chunkSize);
        const res = await fetch(`/replication/cargo/stream/${manifestId}`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Cargo-Offset': String(offset)
            },
            body: slice
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Upload chunk failed');
        offset += slice.size;
        replicationCargoSetStatus(root, `Uploading… ${offset}/${file.size}`);
    }

    const complete = await replicationCargoPost('/replication/cargo/import/complete', { manifestId });
    const responsePath = complete.manifestId
        ? `dreamscape-cargo-response-${complete.manifestId}.json`
        : null;
    replicationCargoPanelState.lastManifestId = complete.manifestId || manifestId;
    const meta = root.querySelector('#replicationCargoMeta');
    if (meta) {
        const accepted = complete.accepted?.length || 0;
        const skipped = complete.skipped?.length || 0;
        let html = `
            <p>Import complete — <strong>${accepted}</strong> accepted, <strong>${skipped}</strong> skipped.</p>
            <p>Manifest <code>${replicationCargoEscapeHtml(complete.manifestId || manifestId)}</code></p>
        `;
        if (responsePath) {
            const responseJson = JSON.stringify(complete, null, 2);
            const blob = new Blob([responseJson], { type: 'application/json' });
            replicationCargoRevokeLastResponseUrl();
            const responseUrl = URL.createObjectURL(blob);
            replicationCargoPanelState.lastResponseUrl = responseUrl;
            html += `<p><a href="${replicationCargoEscapeHtml(responseUrl)}" download="${replicationCargoEscapeHtml(responsePath)}">Download ${replicationCargoEscapeHtml(responsePath)}</a></p>`;
        }
        meta.innerHTML = html;
    }
    replicationCargoSetStatus(root, `Import complete (${complete.accepted?.length || 0} accepted)`);
    if (host && host.showToast) host.showToast('success', 'Cargo imported');
}

async function replicationCargoHandleImport(root, host) {
    const input = root.querySelector('#replicationCargoFileInput');
    if (!input) return;
    input.value = '';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            await replicationCargoUploadFile(root, host, file);
        } catch (err) {
            replicationCargoSetStatus(root, `Import failed: ${err.message}`);
            if (host && host.showToast) host.showToast('error', err.message);
        }
    };
    input.click();
}

async function replicationCargoHandleUpsert(root, host) {
    replicationCargoSetStatus(root, 'Starting Upsert…');
    try {
        const mode = replicationCargoGetEffectiveMode();
        const body = { transferMode: mode };
        if (mode === 'blocks') body.blocksAck = REPLICATION_CARGO_BLOCKS_WARNING;
        await replicationCargoPost('/replication/cargo/upsert/begin', body);
        await replicationCargoPost('/replication/cargo/upsert/send', body);
        replicationCargoSetStatus(root, 'Upsert sent to master');
        if (host && host.showToast) host.showToast('success', 'Upsert complete');
        if (host?.navigate) host.navigate('dsap://data.dreamscape.jp/replication/progress');
    } catch (err) {
        replicationCargoSetStatus(root, `Upsert failed: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

function replicationCargoWirePanel(root, host) {
    replicationCargoWireModePicker(root, host, '#replicationCargoModeBtn', '#replicationCargoModeLabel', true);
    root.querySelector('#replicationCargoExportBtn')?.addEventListener('click', () => {
        replicationCargoHandleExport(root, host);
    });
    root.querySelector('#replicationCargoImportBtn')?.addEventListener('click', () => {
        replicationCargoHandleImport(root, host);
    });
    root.querySelector('#replicationCargoUpsertBtn')?.addEventListener('click', () => {
        replicationCargoHandleUpsert(root, host);
    });
    if (host && typeof host.on === 'function') {
        host.on('replication_progress', () => replicationCargoRenderProgress(root));
        host.on('replication_maintenance', () => replicationCargoRefreshStatus(root, host));
    }
    replicationCargoRefreshStatus(root, host);
}

function replicationCargoDestroyPanel(root) {
    const btn = root.querySelector('#replicationCargoModeBtn');
    if (btn && typeof contextMenu !== 'undefined') {
        contextMenu.detachClickMenuFromElement(btn);
    }
    replicationCargoRevokeLastResponseUrl();
    replicationCargoPanelState.overrideMode = null;
}

function replicationDsapCargoBuildPanel() {
    return replicationCargoBuildUpsertPageHtml();
}

function replicationDsapCargoInitPanel(root, host) {
    if (!root) return;
    setTimeout(() => replicationCargoWirePanel(root, host), 0);
}

function replicationDsapCargoDestroyPanel(root) {
    replicationCargoDestroyPanel(root);
}

function replicationDsapCargoRefreshPanel(root, host) {
    replicationCargoRenderProgress(root);
    return replicationCargoRefreshStatus(root, host);
}
