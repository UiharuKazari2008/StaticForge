/**
 * Replication sync DSAP panel — full sync (Upsert + changelog pull).
 * Depends on: dsapSmfMarkup.js, confirmationDialog.js, contextMenu.js
 */

const REPLICATION_SYNC_TRANSFER_MODES = [
    { id: 'tape-stream-compressed', label: 'Tape Stream (Compressed)' },
    { id: 'tape-stream', label: 'Tape Stream' },
    { id: 'blocks', label: 'Blocks (slow)' }
];

const REPLICATION_SYNC_BLOCKS_WARNING = 'Transforming cargo as Blocks (file-by-file) may be extremely slow for large galleries. Prefer Tape Stream (Compressed) unless you need a single file.';

let replicationSyncPanelState = {
    transferMode: 'tape-stream-compressed',
    overrideMode: null,
    statusText: 'Idle',
    lastMaxLsn: null,
    defaultTransferMode: 'tape-stream-compressed'
};

function replicationSyncEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function replicationSyncGetEffectiveMode() {
    return replicationSyncPanelState.overrideMode || replicationSyncPanelState.transferMode;
}

function replicationSyncGetSelectedModeLabel() {
    const mode = replicationSyncGetEffectiveMode();
    const found = REPLICATION_SYNC_TRANSFER_MODES.find((m) => m.id === mode);
    return found ? found.label : mode;
}

function replicationSyncDefaultModeLabel(modeId) {
    const found = REPLICATION_SYNC_TRANSFER_MODES.find((m) => m.id === modeId);
    return found ? found.label : modeId;
}

async function replicationSyncFetchStatus() {
    const res = await fetch('/replication/status', { credentials: 'same-origin' });
    if (!res.ok) {
        const err = new Error(`Status HTTP ${res.status}`);
        console.error('[replication-sync] fetch /replication/status failed:', err.message);
        throw err;
    }
    const json = await res.json();
    return json.data || json;
}

async function replicationSyncFetchSyncState() {
    const res = await fetch('/replication/sync/status', { credentials: 'same-origin' });
    if (!res.ok) {
        const err = new Error(`Sync status HTTP ${res.status}`);
        console.error('[replication-sync] fetch /replication/sync/status failed:', err.message);
        throw err;
    }
    const json = await res.json();
    return json.data || json;
}

async function replicationSyncPost(path, body) {
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
        console.error('[replication-sync] POST', path, 'failed:', err.message);
        throw err;
    }
    return json.data;
}

function replicationSyncSetStatus(root, text) {
    replicationSyncPanelState.statusText = text;
    const el = root.querySelector('#replicationSyncStatusMessage');
    if (el) el.textContent = text;
}

function replicationSyncWireModePicker(root) {
    const btn = root.querySelector('#replicationSyncModeBtn');
    if (!btn || typeof contextMenu === 'undefined') return;

    const items = REPLICATION_SYNC_TRANSFER_MODES.map((mode) => ({
        text: mode.label,
        action: () => {
            if (mode.id === 'blocks') {
                // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
                showConfirmationDialog(
                    'Blocks transfer mode',
                    REPLICATION_SYNC_BLOCKS_WARNING,
                    () => {
                        replicationSyncPanelState.overrideMode = mode.id;
                        const label = root.querySelector('#replicationSyncModeLabel');
                        if (label) label.textContent = mode.label;
                    },
                    null,
                    { confirmText: 'Use Blocks', cancelText: 'Cancel' }
                );
                return;
            }
            replicationSyncPanelState.overrideMode = mode.id;
            const label = root.querySelector('#replicationSyncModeLabel');
            if (label) label.textContent = mode.label;
        }
    }));

    contextMenu.attachClickMenuToElement(btn, items);
}

function replicationSyncBuildPanelHtml() {
    const defaultLabel = replicationSyncEscapeHtml(replicationSyncDefaultModeLabel(replicationSyncPanelState.defaultTransferMode));
    const overrideLabel = replicationSyncEscapeHtml(replicationSyncGetSelectedModeLabel());
    return `
        <div class="replication-sync-panel" data-replication-sync-panel="1">
            ${dsapSmfBuildSectionHdr('Sync from Master')}
            <table class="dsap-smf-stats-table" id="replicationSyncStatsTable">
                <tbody>
                    <tr>
                        <td class="dsap-smf-stats-label">Default mode</td>
                        <td id="replicationSyncDefaultMode">${defaultLabel}</td>
                        <td class="dsap-smf-stats-label">This operation</td>
                        <td>
                            <button type="button" class="dsap-smf-btn" id="replicationSyncModeBtn">
                                <span id="replicationSyncModeLabel">${overrideLabel}</span>
                                <i class="fas fa-caret-down"></i>
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <td class="dsap-smf-stats-label">Last applied LSN</td>
                        <td id="replicationSyncLastLsn">—</td>
                        <td class="dsap-smf-stats-label">Sync phase</td>
                        <td id="replicationSyncPhase">—</td>
                    </tr>
                    <tr>
                        <td class="dsap-smf-stats-label">Maintenance</td>
                        <td id="replicationSyncMaintenance" colspan="3">—</td>
                    </tr>
                </tbody>
            </table>
            ${dsapSmfBuildStatusBox('<span id="replicationSyncStatusMessage">Idle</span>', 'replicationSyncStatusBox', 'replicationSyncStatusMessage')}
            <div class="dsap-smf-toolbar replication-sync-toolbar">
                <button type="button" class="dsap-smf-btn dsap-smf-btn-primary" id="replicationSyncRunBtn">
                    <i class="fas fa-arrows-rotate"></i> Run full sync
                </button>
            </div>
            <p class="replication-sync-hint">Upserts local cargo to master, pulls master changelog, applies merge rules, and exchanges user acks.</p>
            ${dsapSmfBuildSectionHdr('Manual transfer')}
            <div class="dsap-smf-toolbar replication-sync-toolbar">
                <button type="button" class="dsap-smf-btn" id="replicationSyncExportBtn">
                    <i class="fas fa-file-export"></i> Export cargo
                </button>
                <button type="button" class="dsap-smf-btn" id="replicationSyncImportBtn">
                    <i class="fas fa-file-import"></i> Import cargo
                </button>
            </div>
            <input type="file" id="replicationSyncFileInput" class="hidden" accept=".tar,.zst,.json,application/octet-stream">
            <div class="replication-sync-meta" id="replicationSyncMeta"></div>
            <div id="replicationSyncProgressHost" class="data-mgmt-repl-progress-host hidden"></div>
        </div>
    `;
}

function replicationSyncResolveLastLsn(status) {
    if (!status) return '—';
    if (status.role === 'child' && status.lastAppliedRemoteLsn) {
        const values = Object.values(status.lastAppliedRemoteLsn);
        if (values.length) return String(Math.max(...values.map((v) => Number(v) || 0)));
    }
    if (status.role === 'master' && Array.isArray(status.children) && status.children.length) {
        const lsns = status.children.map((c) => Number(c.lastSyncLsn) || 0);
        return String(Math.max(...lsns));
    }
    return '0';
}

function replicationSyncRenderProgress(root) {
    const host = root.querySelector('#replicationSyncProgressHost');
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

async function replicationSyncRefreshStatus(root, host) {
    try {
        const status = await replicationSyncFetchStatus();
        const syncState = await replicationSyncFetchSyncState().catch(() => null);

        const defaultEl = root.querySelector('#replicationSyncDefaultMode');
        const lsnEl = root.querySelector('#replicationSyncLastLsn');
        const phaseEl = root.querySelector('#replicationSyncPhase');
        const maintEl = root.querySelector('#replicationSyncMaintenance');

        if (status.transferMode) {
            replicationSyncPanelState.defaultTransferMode = status.transferMode;
            if (!replicationSyncPanelState.overrideMode) {
                replicationSyncPanelState.transferMode = status.transferMode;
            }
        }
        if (defaultEl) {
            defaultEl.textContent = replicationSyncDefaultModeLabel(status.transferMode || 'tape-stream-compressed');
        }
        if (lsnEl) lsnEl.textContent = replicationSyncResolveLastLsn(status);
        if (phaseEl) phaseEl.textContent = syncState?.phase || 'idle';
        if (maintEl) {
            maintEl.textContent = status.maintenance?.active
                ? `${status.maintenance.operation || 'active'}`
                : 'off';
        }

        const syncBtn = root.querySelector('#replicationSyncRunBtn');
        if (syncBtn) {
            const airgapped = status.connectivity === 'airgapped';
            const wrongRole = status.role !== 'child';
            const busy = syncState?.active === true || status.maintenance?.active;
            const disabled = airgapped || wrongRole || busy;
            syncBtn.disabled = disabled;
            if (airgapped) {
                syncBtn.title = 'Sync disabled in airgapped mode — use Export cargo';
            } else if (wrongRole) {
                syncBtn.title = status.role === 'ephemeral'
                    ? 'Full sync is not available for ephemeral — use Export cargo'
                    : 'Full sync requires child role';
            } else if (busy) {
                syncBtn.title = 'Sync already in progress';
            } else {
                syncBtn.title = '';
            }
        }

        replicationSyncSetStatus(root, replicationSyncPanelState.statusText);
        replicationSyncRenderProgress(root);

        if (status.maintenance?.active && host?.navigate) {
            host.navigate('dsap://data.dreamscape.jp/replication/progress');
        }
    } catch (err) {
        replicationSyncSetStatus(root, `Status error: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

async function replicationSyncHandleRun(root, host) {
    replicationSyncSetStatus(root, 'Starting full sync…');
    try {
        const mode = replicationSyncGetEffectiveMode();
        const body = { transferMode: mode };
        if (mode === 'blocks') body.blocksAck = REPLICATION_SYNC_BLOCKS_WARNING;
        const result = await replicationSyncPost('/replication/sync/begin', body);
        replicationSyncPanelState.lastMaxLsn = result.maxLsn;
        const meta = root.querySelector('#replicationSyncMeta');
        if (meta) {
            meta.innerHTML = `
                <p>Applied <strong>${replicationSyncEscapeHtml(result.applied)}</strong>,
                skipped <strong>${replicationSyncEscapeHtml(result.skipped)}</strong>,
                max LSN <code>${replicationSyncEscapeHtml(result.maxLsn)}</code></p>
            `;
        }
        replicationSyncSetStatus(root, `Sync complete (LSN ${result.maxLsn})`);
        if (host && host.showToast) host.showToast('success', 'Replication sync complete');
        await replicationSyncRefreshStatus(root, host);
    } catch (err) {
        replicationSyncSetStatus(root, `Sync failed: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

async function replicationSyncHandleManualExport(root, host) {
    replicationSyncSetStatus(root, 'Exporting cargo…');
    try {
        const mode = replicationSyncGetEffectiveMode();
        const body = { transferMode: mode };
        if (mode === 'blocks') body.blocksAck = REPLICATION_SYNC_BLOCKS_WARNING;
        const data = await replicationSyncPost('/replication/cargo/export', body);
        const meta = root.querySelector('#replicationSyncMeta');
        if (meta) {
            meta.innerHTML = `
                <p>Manifest <code>${replicationSyncEscapeHtml(data.manifestId)}</code></p>
                <p><a href="${replicationSyncEscapeHtml(data.streamUrl)}" download>Download cargo stream</a></p>
            `;
        }
        replicationSyncSetStatus(root, `Export ready (${data.manifest?.entries?.length || 0} entries)`);
        if (host && host.showToast) host.showToast('success', 'Cargo export ready');
    } catch (err) {
        replicationSyncSetStatus(root, `Export failed: ${err.message}`);
        if (host && host.showToast) host.showToast('error', err.message);
    }
}

async function replicationSyncUploadFile(root, host, file) {
    replicationSyncSetStatus(root, 'Preparing import…');
    const mode = replicationSyncGetEffectiveMode();
    const body = { transferMode: mode, operation: 'import' };
    if (mode === 'blocks') body.blocksAck = REPLICATION_SYNC_BLOCKS_WARNING;
    const begin = await replicationSyncPost('/replication/cargo/import/begin', body);
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
        replicationSyncSetStatus(root, `Uploading… ${offset}/${file.size}`);
    }
    const complete = await replicationSyncPost('/replication/cargo/import/complete', { manifestId });
    replicationSyncSetStatus(root, `Import complete (${complete.accepted?.length || 0} accepted)`);
    if (host && host.showToast) host.showToast('success', 'Cargo imported');
}

async function replicationSyncHandleManualImport(root, host) {
    const input = root.querySelector('#replicationSyncFileInput');
    if (!input) return;
    input.value = '';
    input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            await replicationSyncUploadFile(root, host, file);
        } catch (err) {
            replicationSyncSetStatus(root, `Import failed: ${err.message}`);
            if (host && host.showToast) host.showToast('error', err.message);
        }
    };
    input.click();
}

function replicationSyncWirePanel(root, host) {
    replicationSyncWireModePicker(root);
    root.querySelector('#replicationSyncRunBtn')?.addEventListener('click', () => {
        replicationSyncHandleRun(root, host);
    });
    root.querySelector('#replicationSyncExportBtn')?.addEventListener('click', () => {
        replicationSyncHandleManualExport(root, host);
    });
    root.querySelector('#replicationSyncImportBtn')?.addEventListener('click', () => {
        replicationSyncHandleManualImport(root, host);
    });

    if (host && typeof host.on === 'function') {
        host.on('replication_sync_status', () => {
            replicationSyncRefreshStatus(root, host);
        });
        host.on('replication_sync_complete', () => {
            replicationSyncRefreshStatus(root, host);
        });
        host.on('replication_progress', () => {
            replicationSyncRenderProgress(root);
            replicationSyncFetchSyncState()
                .then((state) => {
                    const phaseEl = root.querySelector('#replicationSyncPhase');
                    if (phaseEl && state?.phase) phaseEl.textContent = state.phase;
                })
                .catch(() => {});
        });
        host.on('replication_maintenance', () => {
            replicationSyncRefreshStatus(root, host);
        });
    }

    replicationSyncRefreshStatus(root, host);
}

function replicationSyncDestroyPanel(root) {
    const btn = root.querySelector('#replicationSyncModeBtn');
    if (btn && typeof contextMenu !== 'undefined') {
        contextMenu.detachClickMenuFromElement(btn);
    }
    replicationSyncPanelState.overrideMode = null;
}

function replicationDsapSyncBuildPanel() {
    return replicationSyncBuildPanelHtml();
}

function replicationDsapSyncInitPanel(root, host) {
    if (!root) return;
    setTimeout(() => replicationSyncWirePanel(root, host), 0);
}

function replicationDsapSyncDestroyPanel(root) {
    replicationSyncDestroyPanel(root);
}

function replicationDsapSyncRefreshPanel(root, host) {
    replicationSyncRenderProgress(root);
    return replicationSyncRefreshStatus(root, host);
}
