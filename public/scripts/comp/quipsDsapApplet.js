/**
 * Dynamic Quips DSAP — dashboard at quips.dyna.dreamscape.jp
 * Depends on: dsapRegistry.js, generationQuipsTray.js, generationQuips.js, dropdown.js, confirmationDialog.js
 */

const QUIPS_DSAP_URL = 'quips.dyna.dreamscape.jp';
const QUIPS_DSAP_TITLE = 'Dynamic Quips';
const QUIPS_DSAP_RESERVED_SEGMENTS = new Set(['phrasebook', 'settings']);

function quipsDsapDecodeSegment(segment) {
    if (!segment) return segment;
    try {
        return decodeURIComponent(segment);
    } catch (e) {
        return segment;
    }
}

function quipsDsapResolveWorkspaceId(host) {
    const segments = host.getPathSegments().map(quipsDsapDecodeSegment);
    if (segments[0] && !QUIPS_DSAP_RESERVED_SEGMENTS.has(segments[0])) {
        return segments[0];
    }
    const fromQuery = host.getQueryParam('workspace') || host.getQueryParam('ws');
    if (fromQuery) return fromQuery;
    if (typeof getActiveWorkspaceIdForQuips === 'function') {
        return getActiveWorkspaceIdForQuips();
    }
    return typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
}

function quipsDsapIsPhrasebookView(host) {
    return host.getPathSegments().includes('phrasebook');
}

function quipsDsapIsSettingsView(host) {
    return host.getPathSegments().includes('settings');
}

function quipsDsapEscapeHtml(text) {
    if (text == null) return '';
    if (typeof quipsTrayEscapeHtml === 'function') return quipsTrayEscapeHtml(text);
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function quipsDsapEscapeAttr(text) {
    if (typeof quipsTrayEscapeHtmlAttribute === 'function') return quipsTrayEscapeHtmlAttribute(text);
    return String(text || '').replace(/"/g, '&quot;');
}

function quipsDsapSanitizePhrasebookHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelector('.quip-wiki-nav')?.remove();
    tpl.content.querySelector('.quip-wiki-controls')?.remove();
    return tpl.innerHTML;
}

function quipsDsapGetCorpusFileCount(workspaceId) {
    if (!workspaceId) return null;
    if (typeof workspaces === 'undefined') return null;
    const ws = workspaces[workspaceId];
    if (!ws) return null;
    if (Array.isArray(ws.files) || Array.isArray(ws.scraps)) {
        return (ws.files || []).length + (ws.scraps || []).length;
    }
    if (ws.fileCount != null) {
        return (ws.fileCount || 0) + (ws.scrapCount || 0);
    }
    return null;
}

function quipsDsapFormatAutoUpdateLabel(auto) {
    if (!auto) return 'Off';
    const schedule = auto.schedule || 'disabled';
    const isOn = auto.enabled === true || (schedule !== 'disabled' && auto.enabled !== false);
    if (isOn && schedule !== 'disabled') {
        let label = auto.scheduleLabel || schedule || 'On';
        if (auto.scanPending) label += ' (scan soon)';
        return label;
    }
    if (auto.lastRunLabel && auto.lastRunLabel !== 'Never') {
        return `Off · last ${auto.lastRunLabel}`;
    }
    return 'Off';
}

function quipsDsapFormatPhrasesPerTermRange(ws) {
    const min = ws?.minPhrasesPerTerm;
    const max = ws?.maxPhrasesPerTerm;
    if (min == null && max == null) return '—';
    if (min != null && max != null && min !== max) return `${min}–${max}`;
    if (min != null) return String(min);
    if (max != null) return String(max);
    return '—';
}

async function quipsDsapSaveWorkspaceSettings(workspaceId, patch) {
    if (!window.wsClient?.isConnected()) {
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', 'Error', 'WebSocket not connected', false, 3000, '<i class="fas fa-exclamation-circle"></i>');
        }
        return null;
    }

    try {
        const result = await window.wsClient.updateUserGlobalSettings({
            generationQuips: {
                byWorkspace: {
                    [workspaceId]: patch
                }
            }
        });
        return result?.settings?.generationQuips?.byWorkspace?.[workspaceId]
            || result?.data?.settings?.generationQuips?.byWorkspace?.[workspaceId]
            || patch;
    } catch (error) {
        if (typeof showQuipsErrorDialog === 'function') {
            showQuipsErrorDialog('Quips settings', error.message || 'Failed to save settings');
        }
        return null;
    }
}

function quipsDsapWorkspaceLabel(workspaceId, status) {
    const fromList = status?.workspaces?.find((w) => w.id === workspaceId);
    if (fromList?.name) return fromList.name;
    if (typeof getWorkspaceLabelForQuips === 'function') {
        return getWorkspaceLabelForQuips(workspaceId);
    }
    if (typeof workspaces !== 'undefined' && workspaces[workspaceId]?.name) {
        return workspaces[workspaceId].name;
    }
    return workspaceId || 'workspace';
}

function quipsDsapDefaultAutoUpdate() {
    return {
        enabled: false,
        schedule: 'disabled',
        scheduleLabel: 'Disabled',
        termLimit: 50,
        grokBatchSize: 3,
        phrasesPerTerm: 15,
        lastRunLabel: 'Never',
        scanPending: false
    };
}

async function quipsDsapFetchAutoUpdate(workspaceId, statusHint) {
    if (statusHint?.autoUpdateByWorkspace?.[workspaceId]) {
        return statusHint.autoUpdateByWorkspace[workspaceId];
    }
    if (typeof generationQuipsTrayStatus !== 'undefined' && generationQuipsTrayStatus?.autoUpdateByWorkspace?.[workspaceId]) {
        return generationQuipsTrayStatus.autoUpdateByWorkspace[workspaceId];
    }
    if (!window.wsClient?.isConnected()) return quipsDsapDefaultAutoUpdate();

    try {
        let status = await window.wsClient.getGenerationQuipsStatus();
        if (typeof normalizeQuipsTrayStatus === 'function') {
            status = normalizeQuipsTrayStatus(status);
        }
        if (status?.autoUpdateByWorkspace?.[workspaceId]) {
            return status.autoUpdateByWorkspace[workspaceId];
        }
    } catch (e) {
        /* ignore */
    }

    return quipsDsapDefaultAutoUpdate();
}

function quipsDsapBuildStatusForWorkspace(rawStatus, workspaceId) {
    if (!rawStatus) return null;
    const ws = rawStatus.workspaces?.find((w) => w.id === workspaceId) || null;
    return {
        ...rawStatus,
        activeWorkspaceId: workspaceId,
        activeWorkspace: ws,
        autoUpdate: rawStatus.autoUpdateByWorkspace?.[workspaceId] || null
    };
}

function quipsDsapFormatStatValue(value, fallback) {
    if (value == null || value === '') return fallback;
    return String(value);
}

function quipsDsapBuildDashboardHtml(workspaceId, wsLabel) {
    const safeLabel = quipsDsapEscapeHtml(wsLabel);
    const safeWs = quipsDsapEscapeAttr(workspaceId);
    return `
<div data-dsap="quips-dyna" class="dsap-root quips-dsap">
<table class="quips-dsap-header" cellspacing="0" cellpadding="6" width="100%" border="0">
  <tr>
    <td class="quips-dsap-header-left">
      <img src="/static_images/logo_icon.png" alt="Dreamscape" style="height:32px; vertical-align:middle; margin-right:8px;">
      <span class="quips-dsap-header-title">Dynamic Quips</span>
    </td>
    <td class="quips-dsap-header-right" align="right">Configuration</td>
  </tr>
</table>
<div class="quips-dsap-wsbar">
  Workspace: <b>${safeLabel}</b>
</div>

<table class="quips-dsap-stats" id="quipsDsapStatsGrid" cellspacing="0" cellpadding="3" width="100%" border="1" style="border-collapse:collapse; background:#fff;">
  <tr>
    <td align="center" width="20%">
      <span class="quips-dsap-stat-label">Quip terms</span><br>
      <span class="quips-dsap-stat-value" data-stat="terms">—</span>
    </td>
    <td align="center" width="20%">
      <span class="quips-dsap-stat-label">Phrases</span><br>
      <span class="quips-dsap-stat-value" data-stat="phrases">—</span>
    </td>
    <td align="center" width="20%">
      <span class="quips-dsap-stat-label">Extracted terms</span><br>
      <span class="quips-dsap-stat-value" data-stat="extracted">—</span>
    </td>
    <td align="center" width="20%">
      <span class="quips-dsap-stat-label">Phrases / term</span><br>
      <span class="quips-dsap-stat-value" data-stat="phrasesPerTerm">—</span>
    </td>
    <td align="center" width="20%">
      <span class="quips-dsap-stat-label">Corpus files</span><br>
      <span class="quips-dsap-stat-value" data-stat="corpusFiles">—</span>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="3">
      <span class="quips-dsap-stat-label">Auto-update</span><br>
      <span class="quips-dsap-stat-value" data-stat="autoUpdate">—</span>
    </td>
    <td align="center" colspan="2">
      <span class="quips-dsap-stat-label">Last generated</span><br>
      <span class="quips-dsap-stat-value" data-stat="lastGenerated">—</span>
    </td>
  </tr>
</table>

<div class="quips-dsap-section-hdr">System Status</div>
<div class="quips-dsap-statusbox" id="quipsDsapStatusCard">
  <span class="quips-dsap-status-message" id="quipsDsapStatusMessage">Loading…</span>
  <span class="quips-dsap-status-detail hidden" id="quipsDsapStatusDetail"></span>
</div>

<div class="quips-dsap-progress-wrap hidden" id="quipsDsapProgressWrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
  <div id="quipsDsapProgressBar"></div>
</div>

<div class="quips-dsap-actions">
  <button type="button" class="quips-dsap-action-btn quips-btn-primary" data-quips-dsap-action="generate"><i class="fas fa-wand-magic-sparkles"></i> Generate</button>
  <button type="button" class="quips-dsap-action-btn" data-quips-dsap-action="view"><i class="fas fa-book"></i> View Phrase Book</button>
  <button type="button" class="quips-dsap-action-btn" data-quips-dsap-action="settings"><i class="fas fa-sliders"></i> Settings</button>
  <div class="quips-dsap-workspace-picker">
    <label class="quips-dsap-workspace-label">Workspace:</label>
    <div id="quipsDsapWorkspaceDropdown" class="custom-dropdown">
      <button type="button" id="quipsDsapWorkspaceBtn" class="custom-dropdown-btn">
        <span id="quipsDsapWorkspaceSelected">${safeLabel}</span>
      </button>
      <div id="quipsDsapWorkspaceMenu" class="custom-dropdown-menu hidden"></div>
    </div>
    <input type="hidden" id="quipsDsapWorkspaceHidden" value="${safeWs}">
  </div>
</div>

<div class="quips-dsap-previews hidden" id="quipsDsapPreviews"></div>
</div>`;
}

function quipsDsapBuildPhrasebookHtml(title) {
    const safeTitle = quipsDsapEscapeHtml(title || 'Phrase book');
    return `
<div data-dsap="quips-dyna" class="dsap-root quips-dsap quips-dsap-phrasebook">
<table class="quips-dsap-header" cellspacing="0" cellpadding="6" width="100%" border="0">
  <tr>
    <td class="quips-dsap-header-left">
      <img src="/static_images/logo_icon.png" alt="Dreamscape" style="height:32px; vertical-align:middle; margin-right:8px;">
      <span class="quips-dsap-header-title">Dynamic Quips — Phrase Book</span>
    </td>
    <td class="quips-dsap-header-right" align="right">Configuration</td>
  </tr>
</table>
<div class="quips-dsap-phrasebook-toolbar">
  <span class="quips-dsap-phrasebook-title">${safeTitle}</span>
</div>
<div class="quips-dsap-phrasebook-body tag-wiki-page" id="quipsDsapPhrasebookBody">
  <div class="quips-dsap-loading">Loading phrase book…</div>
</div>
</div>`;
}

function quipsDsapBuildSettingsHtml(workspaceId, wsLabel) {
    const safeLabel = quipsDsapEscapeHtml(wsLabel);
    const safeWs = quipsDsapEscapeAttr(workspaceId);
    return `
<div data-dsap="quips-dyna" class="dsap-root quips-dsap quips-dsap-settings">
<table class="quips-dsap-header" cellspacing="0" cellpadding="6" width="100%" border="0">
  <tr>
    <td class="quips-dsap-header-left">
      <img src="/static_images/logo_icon.png" alt="Dreamscape" style="height:32px; vertical-align:middle; margin-right:8px;">
      <span class="quips-dsap-header-title">Dynamic Quips — Settings</span>
    </td>
    <td class="quips-dsap-header-right" align="right">Configuration</td>
  </tr>
</table>
<div class="quips-dsap-phrasebook-toolbar">
  <span class="quips-dsap-phrasebook-title">Settings — ${safeLabel}</span>
</div>

<p class="quips-dsap-settings-intro">Configure automatic scans and generation parameters for this workspace. Changes save immediately.</p>

<table class="quips-dsap-settings-table" cellspacing="0" cellpadding="4" border="0" width="100%">
  <tr>
    <td class="quips-dsap-setting-label">Automatic updates</td>
    <td>
      <div id="quipsDsapScheduleDropdown" class="custom-dropdown">
        <button type="button" id="quipsDsapScheduleBtn" class="custom-dropdown-btn">
          <span id="quipsDsapScheduleSelected">Loading…</span>
        </button>
        <div id="quipsDsapScheduleMenu" class="custom-dropdown-menu hidden"></div>
      </div>
      <input type="hidden" id="quipsDsapScheduleHidden" value="disabled">
    </td>
    <td class="quips-dsap-setting-hint-cell"><span id="quipsDsapLastRunHint"></span></td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Terms to rank</td>
    <td>
      <div id="quipsDsapTermLimitDropdown" class="custom-dropdown">
        <button type="button" id="quipsDsapTermLimitBtn" class="custom-dropdown-btn">
          <span id="quipsDsapTermLimitSelected">50</span>
        </button>
        <div id="quipsDsapTermLimitMenu" class="custom-dropdown-menu hidden"></div>
      </div>
      <input type="hidden" id="quipsDsapTermLimitHidden" value="50">
    </td>
    <td class="quips-dsap-setting-hint-cell">How many prompt terms to extract and rank per scan</td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Terms per Grok batch</td>
    <td>
      <div id="quipsDsapGrokBatchDropdown" class="custom-dropdown">
        <button type="button" id="quipsDsapGrokBatchBtn" class="custom-dropdown-btn">
          <span id="quipsDsapGrokBatchSelected">3</span>
        </button>
        <div id="quipsDsapGrokBatchMenu" class="custom-dropdown-menu hidden"></div>
      </div>
      <input type="hidden" id="quipsDsapGrokBatchHidden" value="3">
    </td>
    <td class="quips-dsap-setting-hint-cell">How many ranked terms to send per Grok request</td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Quips per term</td>
    <td>
      <div id="quipsDsapPhrasesPerTermDropdown" class="custom-dropdown">
        <button type="button" id="quipsDsapPhrasesPerTermBtn" class="custom-dropdown-btn">
          <span id="quipsDsapPhrasesPerTermSelected">15</span>
        </button>
        <div id="quipsDsapPhrasesPerTermMenu" class="custom-dropdown-menu hidden"></div>
      </div>
      <input type="hidden" id="quipsDsapPhrasesPerTermHidden" value="15">
    </td>
    <td class="quips-dsap-setting-hint-cell">How many phrases Grok generates for each ranked term</td>
  </tr>
</table>

<div class="quips-dsap-settings-actions">
  <button type="button" class="quips-dsap-action-btn quips-btn-primary" data-quips-dsap-action="generate"><i class="fas fa-wand-magic-sparkles"></i> Generate quips</button>
  <button type="button" class="quips-dsap-action-btn" data-quips-dsap-action="extract"><i class="fas fa-list"></i> Re-extract terms</button>
  <button type="button" class="quips-dsap-action-btn" data-quips-dsap-action="refresh-cache"><i class="fas fa-download"></i> Refresh client cache</button>
  <button type="button" class="quips-dsap-action-btn quips-btn-danger" data-quips-dsap-action="clear"><i class="fas fa-trash"></i> Clear all</button>
</div>
</div>`;
}

const quipsDsapScopedCss = `
[data-dsap="quips-dyna"].quips-dsap,
[data-dsap="quips-dyna"].quips-dsap *:not(i) {
  font-family: Arial, Helvetica, sans-serif !important;
}
[data-dsap="quips-dyna"].quips-dsap {
  background: #eeeeee;
  color: #000000;
  font-size: 12pt;
  line-height: 1.3;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid #666666;
}
/* Tighter outer padding for the phrasebook view (less wasted space) */
[data-dsap="quips-dyna"].quips-dsap.quips-dsap-phrasebook {
  padding: 3px 4px;
}

/* Larger top header bar (web 1.5 / Dreamscape backend config style) */
[data-dsap="quips-dyna"] .quips-dsap-header {
  background: #003366;
  color: #ffffff;
  border: 1px solid #000033;
  margin-bottom: 4px;
  min-height: 40px;
}
[data-dsap="quips-dyna"].quips-dsap.quips-dsap-phrasebook .quips-dsap-header {
  margin-bottom: 2px;
}
[data-dsap="quips-dyna"] .quips-dsap-header-left {
  padding: 5px 8px;
  vertical-align: middle;
}
[data-dsap="quips-dyna"] .quips-dsap-header-title {
  font-weight: bold;
  font-size: 13pt;
  vertical-align: middle;
}
[data-dsap="quips-dyna"] .quips-dsap-header-right {
  font-size: 11pt;
  color: #ffffff;
  padding: 5px 10px;
  text-align: right;
  vertical-align: middle;
  font-weight: bold;
  letter-spacing: 0.5px;
  background: #001a33;
  border: 1px solid #336699;
}

[data-dsap="quips-dyna"] .quips-dsap-wsbar {
  background: #336699;
  color: #ffffff;
  padding: 3px 8px;
  font-size: 11pt;
  margin: 2px 0 5px;
  border: 1px solid #000033;
}

[data-dsap="quips-dyna"] .quips-dsap-section-hdr {
  background: #000066;
  color: #ffffff;
  font-weight: bold;
  font-size: 11pt;
  padding: 2px 5px;
  margin: 5px 0 3px;
  border: 1px solid #000033;
}

/* Old-school stats table (cell borders like 2005 admin pages) */
[data-dsap="quips-dyna"] .quips-dsap-stats {
  background: #ffffff;
  border: 1px solid #666666;
  border-collapse: collapse;
  margin-bottom: 5px;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-stats td {
  background: #ffffff;
  border: 1px solid #999999;
  padding: 4px 6px;
  text-align: center;
  vertical-align: middle;
}
[data-dsap="quips-dyna"] .quips-dsap-stat-label {
  display: block;
  font-size: 11pt;
  color: #111111;
  font-weight: bold;
  margin-bottom: 1px;
}
[data-dsap="quips-dyna"] .quips-dsap-stat-value {
  font-size: 11pt;
  font-weight: bold;
  color: #000000;
  word-break: break-word;
}

/* Status box */
[data-dsap="quips-dyna"] .quips-dsap-statusbox {
  border: 1px solid #666666;
  background: #ffffee;
  padding: 5px 7px;
  margin-bottom: 5px;
  min-height: 36px;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-status-message {
  font-size: 11pt;
  color: #000000;
  font-weight: bold;
}
[data-dsap="quips-dyna"] .quips-dsap-status-detail {
  font-size: 11pt;
  color: #222222;
  display: block;
  margin-top: 2px;
}
[data-dsap="quips-dyna"] .quips-dsap-status-detail.hidden {
  display: none;
}
[data-dsap="quips-dyna"] .quips-dsap-statusbox.quips-dsap-status-running {
  background: #ffffcc;
}
[data-dsap="quips-dyna"] .quips-dsap-statusbox.quips-dsap-status-running .quips-dsap-status-message {
  color: #003366;
  font-weight: bold;
}

/* Retro progress bar (chunky, no radius, solid colors) */
[data-dsap="quips-dyna"] .quips-dsap-progress-wrap {
  height: 16px;
  background: #ffffff;
  border: 1px solid #000000;
  padding: 1px;
  margin: 4px 0;
  overflow: hidden;
}
[data-dsap="quips-dyna"] .quips-dsap-progress-wrap.hidden {
  display: none;
}
[data-dsap="quips-dyna"] #quipsDsapProgressBar {
  height: 100%;
  width: 0%;
  background: #003399;
}

/* Action buttons row + picker — more Windows 98 style: rounded + orange border + classic bevel */
[data-dsap="quips-dyna"] .quips-dsap-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 4px;
  margin: 5px 0;
}
[data-dsap="quips-dyna"] .quips-dsap-action-btn {
  font-size: 9pt;
  font-weight: bold;
  background: #c0c0c0;
  color: #000000;
  border: 1px solid #ff8c00;
  border-radius: 3px;
  padding: 5px 12px;
  margin: 0;
  cursor: pointer;
  line-height: 1.15;
  box-shadow:
    1px 1px 0 #ffffff inset,
    -1px -1px 0 #808080 inset;
}
[data-dsap="quips-dyna"] .quips-dsap-action-btn:active {
  box-shadow:
    -1px -1px 0 #ffffff inset,
    1px 1px 0 #808080 inset;
  background: #b0b0b0;
}
[data-dsap="quips-dyna"] .quips-btn-primary {
  background: #d4d8e0;
  border: 2px solid #ff8c00;
  box-shadow:
    1px 1px 0 #ffffff inset,
    -1px -1px 0 #606060 inset;
}
[data-dsap="quips-dyna"] .quips-btn-primary:active {
  background: #c0c4cc;
  box-shadow:
    -1px -1px 0 #ffffff inset,
    1px 1px 0 #606060 inset;
}
[data-dsap="quips-dyna"] .quips-btn-danger {
  background: #e8a8a8;
  color: #330000;
  border: 1px solid #cc4400;
}
[data-dsap="quips-dyna"] .quips-dsap-workspace-picker {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  margin-left: 8px;
  min-width: 150px;
}
[data-dsap="quips-dyna"] .quips-dsap-workspace-label {
  font-size: 11pt;
  color: #111111;
  font-weight: bold;
}

/* Previews (generation in progress samples) */
[data-dsap="quips-dyna"] .quips-dsap-previews {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 3px;
}
[data-dsap="quips-dyna"] .quips-dsap-previews.hidden {
  display: none;
}
[data-dsap="quips-dyna"] .quips-dsap-preview-row {
  font-family: monospace;
  font-size: 11pt;
  padding: 2px 4px;
  background: #f4f4f4;
  border: 1px solid #cccccc;
  display: flex;
  gap: 4px;
}
[data-dsap="quips-dyna"] .quips-dsap-preview-term {
  font-weight: bold;
  color: #003366;
  flex-shrink: 0;
}
[data-dsap="quips-dyna"] .quips-dsap-preview-phrase {
  color: #111111;
}

/* Phrasebook subpage - tightened for compact view */
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 1px 0;
  background: #f0f0f0;
  padding: 2px 4px;
  border-bottom: 1px solid #999;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-title {
  font-weight: bold;
  color: #000000;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body {
  min-height: 140px;
  background: #ffffff;
  border: 1px solid #666;
  padding: 2px 3px;
  margin-top: 1px;
  overflow: auto;
  line-height: 1.15;
}
[data-dsap="quips-dyna"] .quips-dsap-loading {
  padding: 6px;
  text-align: center;
  color: #111111;
  font-size: 11pt;
}

/* Settings page - classic table form */
[data-dsap="quips-dyna"] .quips-dsap-settings-intro {
  margin: 5px 0;
  color: #333333;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-settings-table {
  background: #f8f8f8;
  border: 1px solid #999999;
  margin: 5px 0;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-settings-table td {
  padding: 4px 6px;
  vertical-align: middle;
  border-bottom: 1px solid #dddddd;
}
[data-dsap="quips-dyna"] .quips-dsap-setting-label {
  font-weight: bold;
  color: #000000;
  white-space: nowrap;
  padding-right: 10px;
  width: 150px;
}
[data-dsap="quips-dyna"] .quips-dsap-setting-hint-cell {
  color: #222222;
  font-size: 11pt;
  padding-left: 8px;
}
[data-dsap="quips-dyna"] .quips-dsap-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

/* Retro overrides for custom dropdowns (used in workspace + settings) - high contrast Linksys/light web1.5 */
[data-dsap="quips-dyna"] .custom-dropdown-btn {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
  color: #000000 !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: 11pt !important;
  padding: 2px 6px !important;
  min-height: 18px !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
[data-dsap="quips-dyna"] .custom-dropdown-btn:hover {
  background: #f0f0f0 !important;
}
[data-dsap="quips-dyna"] .custom-dropdown-menu {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
  box-shadow: none !important;
  font-size: 11pt !important;
  min-width: 130px !important;
  border-radius: 0 !important;
  padding: 2px 0 !important;
}
[data-dsap="quips-dyna"] .custom-dropdown-menu .dd-item,
[data-dsap="quips-dyna"] .custom-dropdown-menu > div {
  padding: 3px 7px !important;
  color: #000000 !important;
  background: transparent !important;
}
[data-dsap="quips-dyna"] .custom-dropdown-menu .dd-item:hover,
[data-dsap="quips-dyna"] .custom-dropdown-menu > div:hover {
  background: #003366 !important;
  color: #ffffff !important;
}

/* Reset for tag-wiki + strong compacting for phrasebook content (kills excessive wiki spacing) */
[data-dsap="quips-dyna"] .tag-wiki-page,
[data-dsap="quips-dyna"] .tag-wiki-page *:not(i) {
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: 11pt;
  color: #000000;
  background: transparent;
  line-height: 1.15;
}
[data-dsap="quips-dyna"] .tag-wiki-error {
  color: #990000;
  font-size: 11pt;
}

/* Compact phrase book wiki output (sections, terms, phrase lists, etc.) */
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body h1,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body h2,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body h3,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body h4 {
  margin: 3px 0 1px !important;
  padding: 0 !important;
  font-size: 11pt !important;
  font-weight: bold;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body p {
  margin: 1px 0 2px !important;
  padding: 0 !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body section,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body article,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-section,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-term,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-doc {
  margin: 1px 0 !important;
  padding: 0 !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body ul,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body ol {
  margin: 1px 0 2px 10px !important;
  padding: 0 !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body li {
  margin: 0 0 1px !important;
  padding: 0 !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body ul.quip-wiki-phrases,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body ul.quip-wiki-phrases li {
  margin: 0 !important;
  padding-left: 12px !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body dl,
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-stats {
  margin: 1px 0 !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body dt {
  margin: 2px 0 0 !important;
  font-weight: bold;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body dd {
  margin: 0 0 1px 10px !important;
  font-size: 11pt;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-term-title {
  font-size: 11pt !important;
  margin: 2px 0 1px !important;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-phrase-count {
  font-size: 11pt;
  opacity: 0.7;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-empty {
  font-style: italic;
  font-size: 11pt;
  margin: 2px 0;
}
[data-dsap="quips-dyna"] .quips-dsap-phrasebook-body .quip-wiki-stat {
  margin: 0 !important;
}

/* Hide any glass/fancy remnants if classes collide */
[data-dsap="quips-dyna"] .quips-dsap-hero,
[data-dsap="quips-dyna"] .quips-dsap-hero-icon,
[data-dsap="quips-dyna"] .quips-dsap-hero-text,
[data-dsap="quips-dyna"] .quips-dsap-subtitle {
  display: none !important;
}
[data-dsap="quips-dyna"] .quips-dsap-stat-card {
  /* old stats are now in table cells; keep rule for any stray usage */
  background: #ffffff;
  border: 1px solid #999;
  padding: 2px;
  font-size: 11pt;
}

/* Do not override font-family on <i> so FontAwesome icons render correctly */
[data-dsap="quips-dyna"] i,
[data-dsap="quips-dyna"] i * {
  font-family: "Font Awesome 5 Free", "Font Awesome 5 Pro", "FontAwesome", sans-serif !important;
  font-weight: 900 !important;
}
`;

const quipsDsapDriver = {
    _state: null,

    init(host) {
        this._state = {
            host,
            workspaceId: quipsDsapResolveWorkspaceId(host),
            status: null,
            settingsDraft: null,
            wsHandlers: []
        };

        const root = host.getRoot();
        if (!root) return;

        this._state._onClick = (e) => this._onClick(e);
        root.addEventListener('click', this._state._onClick);

        if (quipsDsapIsPhrasebookView(host)) {
            void this._loadPhrasebook();
        } else if (quipsDsapIsSettingsView(host)) {
            void this._loadSettings();
        } else {
            void this._loadDashboard();
        }

        this._bindWsEvents(host);
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (!state) return;

        const root = host?.getRoot?.();
        if (root && state._onClick) {
            root.removeEventListener('click', state._onClick);
        }

        if (root && typeof teardownDropdown === 'function') {
            root.querySelectorAll('.custom-dropdown').forEach((el) => teardownDropdown(el));
        }

        if (window.wsClient && typeof window.wsClient.off === 'function') {
            state.wsHandlers.forEach(({ event, fn }) => window.wsClient.off(event, fn));
        }
        this._state = null;
    },

    _bindWsEvents(host) {
        if (!window.wsClient || typeof window.wsClient.on !== 'function') return;

        const onProgress = (msg) => {
            const data = msg?.data || msg;
            const wsId = this._state.workspaceId;
            if (data?.status) {
                const applied = typeof applyQuipsBroadcastStatus === 'function'
                    ? applyQuipsBroadcastStatus(data.status)
                    : data.status;
                this._state.status = typeof quipsDsapBuildStatusForWorkspace === 'function'
                    ? quipsDsapBuildStatusForWorkspace(applied, wsId)
                    : applied;
            } else if (data?.generation) {
                this._state.status = {
                    ...(this._state.status || {}),
                    generation: data.generation
                };
            }
            this._renderStatusCard();
            this._renderProgress();
        };

        const onStatus = (msg) => {
            const data = msg?.data || msg;
            const wsId = this._state.workspaceId;
            if (data) {
                const applied = typeof applyQuipsBroadcastStatus === 'function'
                    ? applyQuipsBroadcastStatus(data)
                    : data;
                this._state.status = typeof quipsDsapBuildStatusForWorkspace === 'function'
                    ? quipsDsapBuildStatusForWorkspace(applied, wsId)
                    : applied;
            }
            this._renderStats();
            this._renderStatusCard();
            this._renderProgress();
        };

        window.wsClient.on('generation_quips_progress', onProgress);
        window.wsClient.on('generation_quips_status', onStatus);
        this._state.wsHandlers.push(
            { event: 'generation_quips_progress', fn: onProgress },
            { event: 'generation_quips_status', fn: onStatus }
        );
    },

    async _loadDashboard() {
        const { workspaceId } = this._state;

        await this._refreshStatus();
        this._wireWorkspaceDropdown();
        this._renderStats();
        this._renderStatusCard();
        this._renderProgress();
    },

    async _loadSettings() {
        const { workspaceId } = this._state;

        await this._refreshStatus();
        const auto = await quipsDsapFetchAutoUpdate(workspaceId, this._state.status);
        this._state.settingsDraft = {
            schedule: auto.schedule || 'disabled',
            enabled: auto.enabled === true || (auto.schedule && auto.schedule !== 'disabled'),
            termLimit: auto.termLimit ?? 50,
            grokBatchSize: auto.grokBatchSize ?? 3,
            phrasesPerTerm: auto.phrasesPerTerm ?? 15,
            lastRunLabel: auto.lastRunLabel || 'Never'
        };
        this._wireSettingsDropdowns();
    },

    async _loadPhrasebook() {
        const { workspaceId } = this._state;

        await this._refreshStatus();

        const body = this._state.host.getRoot()?.querySelector('#quipsDsapPhrasebookBody');
        if (!body || !window.wsClient?.isConnected()) {
            if (body) body.innerHTML = '<div class="tag-wiki-error">WebSocket not connected</div>';
            return;
        }

        try {
            const result = await window.wsClient.getGenerationQuipsWiki({ workspaceId });
            if (result?.html) {
                body.innerHTML = quipsDsapSanitizePhrasebookHtml(result.html);
            } else {
                body.innerHTML = '<div class="tag-wiki-error">No quip data to display</div>';
            }
        } catch (error) {
            body.innerHTML = `<div class="tag-wiki-error">${quipsDsapEscapeHtml(error.message || 'Failed to load phrase book')}</div>`;
        }
    },

    async _persistSettingsDraft() {
        const { workspaceId, settingsDraft } = this._state;
        if (!settingsDraft) return;

        const schedule = settingsDraft.schedule || 'disabled';
        const patch = {
            schedule,
            enabled: schedule !== 'disabled',
            termLimit: settingsDraft.termLimit,
            grokBatchSize: settingsDraft.grokBatchSize,
            phrasesPerTerm: settingsDraft.phrasesPerTerm
        };

        const saved = await quipsDsapSaveWorkspaceSettings(workspaceId, patch);
        if (saved) {
            await this._refreshStatus();
            const auto = await quipsDsapFetchAutoUpdate(workspaceId, this._state.status);
            this._state.settingsDraft = {
                schedule: auto.schedule || 'disabled',
                enabled: auto.enabled === true || (auto.schedule && auto.schedule !== 'disabled'),
                termLimit: auto.termLimit ?? 50,
                grokBatchSize: auto.grokBatchSize ?? 3,
                phrasesPerTerm: auto.phrasesPerTerm ?? 15,
                lastRunLabel: auto.lastRunLabel || 'Never'
            };
            if (this._state.status) {
                this._state.status = {
                    ...this._state.status,
                    autoUpdate: auto,
                    autoUpdateByWorkspace: {
                        ...(this._state.status.autoUpdateByWorkspace || {}),
                        [workspaceId]: auto
                    }
                };
            }
            const root = this._state.host.getRoot();
            const lastRunEl = root?.querySelector('#quipsDsapLastRunHint');
            if (lastRunEl) {
                lastRunEl.textContent = auto.lastRunLabel && auto.lastRunLabel !== 'Never'
                    ? `Last automatic run: ${auto.lastRunLabel}`
                    : 'Last automatic run: Never';
            }
        }
    },

    _wireSettingsDropdowns() {
        const root = this._state.host.getRoot();
        const draft = this._state.settingsDraft;
        if (!root || !draft) return;

        const lastRunEl = root.querySelector('#quipsDsapLastRunHint');
        if (lastRunEl) {
            lastRunEl.textContent = draft.lastRunLabel && draft.lastRunLabel !== 'Never'
                ? `Last automatic run: ${draft.lastRunLabel}`
                : 'Last automatic run: Never';
        }

        this._wireSimpleSettingDropdown({
            containerId: 'quipsDsapScheduleDropdown',
            btnId: 'quipsDsapScheduleBtn',
            menuId: 'quipsDsapScheduleMenu',
            selectedId: 'quipsDsapScheduleSelected',
            hiddenId: 'quipsDsapScheduleHidden',
            initialValue: draft.schedule || 'disabled',
            renderMenu: (menu, btn, selectedEl, hidden, currentVal, onSelect) => {
                if (typeof buildQuipsAutoScheduleDropdownGroups !== 'function' || typeof renderGroupedDropdown !== 'function') return;
                renderGroupedDropdown(
                    menu,
                    buildQuipsAutoScheduleDropdownGroups(),
                    (value) => {
                        draft.schedule = value;
                        draft.enabled = value !== 'disabled';
                        selectedEl.textContent = typeof getQuipsAutoScheduleLabel === 'function'
                            ? getQuipsAutoScheduleLabel(value)
                            : value;
                        hidden.value = value;
                        onSelect(value);
                    },
                    () => closeDropdown(menu, btn),
                    currentVal,
                    (opt) => quipsDsapEscapeHtml(opt.label)
                );
            },
            labelForValue: (value) => (typeof getQuipsAutoScheduleLabel === 'function'
                ? getQuipsAutoScheduleLabel(value)
                : value),
            onSelect: () => this._persistSettingsDraft()
        });

        this._wireNumericSettingDropdown({
            containerId: 'quipsDsapTermLimitDropdown',
            btnId: 'quipsDsapTermLimitBtn',
            menuId: 'quipsDsapTermLimitMenu',
            selectedId: 'quipsDsapTermLimitSelected',
            hiddenId: 'quipsDsapTermLimitHidden',
            options: QUIPS_TERM_LIMIT_OPTIONS,
            initialValue: draft.termLimit,
            onSelect: (value) => {
                draft.termLimit = value;
                this._persistSettingsDraft();
            }
        });

        this._wireNumericSettingDropdown({
            containerId: 'quipsDsapGrokBatchDropdown',
            btnId: 'quipsDsapGrokBatchBtn',
            menuId: 'quipsDsapGrokBatchMenu',
            selectedId: 'quipsDsapGrokBatchSelected',
            hiddenId: 'quipsDsapGrokBatchHidden',
            options: QUIPS_GROK_BATCH_OPTIONS,
            initialValue: draft.grokBatchSize,
            onSelect: (value) => {
                draft.grokBatchSize = value;
                this._persistSettingsDraft();
            }
        });

        this._wireNumericSettingDropdown({
            containerId: 'quipsDsapPhrasesPerTermDropdown',
            btnId: 'quipsDsapPhrasesPerTermBtn',
            menuId: 'quipsDsapPhrasesPerTermMenu',
            selectedId: 'quipsDsapPhrasesPerTermSelected',
            hiddenId: 'quipsDsapPhrasesPerTermHidden',
            options: QUIPS_PHRASES_PER_TERM_OPTIONS,
            initialValue: draft.phrasesPerTerm,
            onSelect: (value) => {
                draft.phrasesPerTerm = value;
                this._persistSettingsDraft();
            }
        });
    },

    _wireSimpleSettingDropdown(config) {
        const root = this._state.host.getRoot();
        const container = root.querySelector(`#${config.containerId}`);
        const btn = root.querySelector(`#${config.btnId}`);
        const menu = root.querySelector(`#${config.menuId}`);
        const selectedEl = root.querySelector(`#${config.selectedId}`);
        const hidden = root.querySelector(`#${config.hiddenId}`);
        if (!container || !btn || !menu || !selectedEl || !hidden) return;
        if (container.getAttribute('data-dropdown-initialized') === 'true') return;

        let currentValue = config.initialValue;
        hidden.value = String(currentValue);
        selectedEl.textContent = config.labelForValue(currentValue);

        const renderMenu = () => {
            config.renderMenu(menu, btn, selectedEl, hidden, currentValue, (value) => {
                currentValue = value;
                config.onSelect(value);
            });
        };

        // setupDropdown: public/scripts/comp/dropdown.js
        if (typeof setupDropdown === 'function') {
            setupDropdown(container, btn, menu, renderMenu, () => currentValue, { preventFocusTransfer: true });
        }
    },

    _wireNumericSettingDropdown(config) {
        const root = this._state.host.getRoot();
        const container = root.querySelector(`#${config.containerId}`);
        const btn = root.querySelector(`#${config.btnId}`);
        const menu = root.querySelector(`#${config.menuId}`);
        const selectedEl = root.querySelector(`#${config.selectedId}`);
        const hidden = root.querySelector(`#${config.hiddenId}`);
        if (!container || !btn || !menu || !selectedEl || !hidden) return;
        if (container.getAttribute('data-dropdown-initialized') === 'true') return;

        let currentValue = config.initialValue;
        hidden.value = String(currentValue);
        selectedEl.textContent = String(currentValue);

        const renderMenu = (selectedVal) => {
            // renderSimpleDropdown, closeDropdown: public/scripts/comp/dropdown.js
            if (typeof renderSimpleDropdown !== 'function') return;
            renderSimpleDropdown(
                menu,
                config.options.map((n) => ({ value: n, name: String(n) })),
                'value',
                'name',
                (value) => {
                    currentValue = value;
                    hidden.value = String(value);
                    selectedEl.textContent = String(value);
                    config.onSelect(value);
                },
                () => closeDropdown(menu, btn),
                selectedVal,
                { preventFocusTransfer: true }
            );
        };

        if (typeof setupDropdown === 'function') {
            setupDropdown(container, btn, menu, renderMenu, () => currentValue, { preventFocusTransfer: true });
        }
    },

    async _refreshStatus() {
        if (!window.wsClient?.isConnected()) {
            this._state.status = null;
            return;
        }
        try {
            let status = await window.wsClient.getGenerationQuipsStatus();
            if (typeof normalizeQuipsTrayStatus === 'function') {
                status = normalizeQuipsTrayStatus(status);
            }
            this._state.status = quipsDsapBuildStatusForWorkspace(status, this._state.workspaceId);
        } catch (e) {
            this._state.status = null;
        }
    },

    _wireWorkspaceDropdown() {
        const { host, workspaceId, status } = this._state;
        const root = host.getRoot();
        const container = root.querySelector('#quipsDsapWorkspaceDropdown');
        const btn = root.querySelector('#quipsDsapWorkspaceBtn');
        const menu = root.querySelector('#quipsDsapWorkspaceMenu');
        const selectedEl = root.querySelector('#quipsDsapWorkspaceSelected');
        const hidden = root.querySelector('#quipsDsapWorkspaceHidden');
        if (!container || !btn || !menu || !selectedEl || !hidden) return;
        if (container.getAttribute('data-dropdown-initialized') === 'true') return;

        const wsList = (status?.workspaces || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (!wsList.length && typeof workspaces !== 'undefined') {
            Object.entries(workspaces).forEach(([id, ws]) => {
                wsList.push({ id, name: ws.name || id });
            });
        }

        let currentId = workspaceId;

        const renderMenu = (selectedVal) => {
            // renderSimpleDropdown, closeDropdown: public/scripts/comp/dropdown.js
            if (typeof renderSimpleDropdown !== 'function') return;
            renderSimpleDropdown(
                menu,
                wsList.map((w) => ({ value: w.id, name: w.name || w.id })),
                'value',
                'name',
                (value) => {
                    currentId = value;
                    hidden.value = value;
                    const label = quipsDsapWorkspaceLabel(value, status);
                    selectedEl.textContent = label;
                    host.navigate(`dsap://${QUIPS_DSAP_URL}/${encodeURIComponent(value)}`);
                },
                () => closeDropdown(menu, btn),
                selectedVal,
                { preventFocusTransfer: true }
            );
        };

        // setupDropdown: public/scripts/comp/dropdown.js
        if (typeof setupDropdown === 'function') {
            setupDropdown(container, btn, menu, renderMenu, () => currentId, { preventFocusTransfer: true });
        }
    },

    _renderStats() {
        const root = this._state?.host?.getRoot();
        if (!root) return;

        const { workspaceId, status } = this._state;
        const ws = status?.workspaces?.find((w) => w.id === workspaceId) || status?.activeWorkspace;
        const auto = status?.autoUpdate || {};

        const setStat = (key, val) => {
            const el = root.querySelector(`[data-stat="${key}"]`);
            if (el) el.textContent = val;
        };

        setStat('terms', quipsDsapFormatStatValue(ws?.termCount, '0'));
        setStat('phrases', quipsDsapFormatStatValue(ws?.phraseCount, '0'));
        setStat('extracted', quipsDsapFormatStatValue(ws?.extractedTermCount, '0'));
        setStat('phrasesPerTerm', quipsDsapFormatPhrasesPerTermRange(ws));
        const corpusCount = quipsDsapGetCorpusFileCount(workspaceId);
        setStat('corpusFiles', corpusCount != null ? String(corpusCount) : '—');

        setStat('autoUpdate', quipsDsapFormatAutoUpdateLabel(auto));

        let lastGen = 'Never';
        if (ws?.lastGeneratedAt) {
            const d = new Date(ws.lastGeneratedAt * 1000);
            lastGen = Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
        } else if ((ws?.termCount || 0) > 0) {
            lastGen = 'Unknown';
        }
        setStat('lastGenerated', lastGen);
    },

    _renderStatusCard() {
        const root = this._state?.host?.getRoot();
        if (!root) return;

        const card = root.querySelector('#quipsDsapStatusCard');
        const messageEl = root.querySelector('#quipsDsapStatusMessage');
        const detailEl = root.querySelector('#quipsDsapStatusDetail');
        if (!messageEl) return;

        const viewStatus = quipsDsapBuildStatusForWorkspace(this._state.status, this._state.workspaceId);
        if (!viewStatus) {
            messageEl.textContent = 'Status unavailable — check connection';
            if (detailEl) {
                detailEl.textContent = '';
                detailEl.classList.add('hidden');
            }
            if (card) card.classList.remove('quips-dsap-status-running');
            return;
        }

        const gen = viewStatus.generation || {};
        const isRunning = gen.status === 'running';

        let message = typeof formatQuipsTrayTitle === 'function'
            ? formatQuipsTrayTitle(viewStatus)
            : 'Dynamic quips';

        let detail = '';
        if (isRunning) {
            if (typeof formatQuipsGenerationDetail === 'function') {
                detail = formatQuipsGenerationDetail(gen) || '';
            }
            if (!detail && gen.message) {
                detail = gen.message;
            }
        } else if (gen.status === 'error') {
            detail = gen.error || gen.message || 'Generation failed';
        }

        messageEl.textContent = message;
        if (detailEl) {
            if (detail) {
                detailEl.textContent = detail;
                detailEl.classList.remove('hidden');
            } else {
                detailEl.textContent = '';
                detailEl.classList.add('hidden');
            }
        }
        if (card) {
            card.classList.toggle('quips-dsap-status-running', isRunning);
        }
    },

    _renderProgress() {
        const root = this._state?.host?.getRoot();
        if (!root) return;

        const viewStatus = quipsDsapBuildStatusForWorkspace(this._state.status, this._state.workspaceId);
        const wrap = root.querySelector('#quipsDsapProgressWrap');
        const bar = root.querySelector('#quipsDsapProgressBar');
        const previewsEl = root.querySelector('#quipsDsapPreviews');
        if (!wrap || !bar) return;

        const gen = viewStatus?.generation || {};
        const isRunning = gen.status === 'running';

        if (!isRunning) {
            wrap.classList.add('hidden');
            bar.style.width = '0%';
            if (previewsEl) previewsEl.classList.add('hidden');
            return;
        }

        const progress = typeof computeQuipsTrayProgress === 'function'
            ? computeQuipsTrayProgress(viewStatus, { generation: gen })
            : (gen.progress || 0);

        wrap.classList.remove('hidden');
        wrap.setAttribute('aria-valuenow', String(progress));
        bar.style.width = `${progress}%`;

        if (previewsEl) {
            const summary = typeof buildQuipsTrayStatusSummary === 'function'
                ? buildQuipsTrayStatusSummary(viewStatus, { generation: gen })
                : { previews: gen.recentPreviews || [] };
            const previews = (summary.previews || []).slice(-4).reverse();
            if (previews.length) {
                previewsEl.classList.remove('hidden');
                previewsEl.innerHTML = previews.map((item) => `
                    <div class="quips-dsap-preview-row">
                        <span class="quips-dsap-preview-term">${quipsDsapEscapeHtml(item.term)}</span>
                        <span class="quips-dsap-preview-phrase">${quipsDsapEscapeHtml(item.phrase)}</span>
                    </div>
                `).join('');
            } else {
                previewsEl.classList.add('hidden');
            }
        }
    },

    async _onClick(e) {
        const btn = e.target.closest('[data-quips-dsap-action]');
        if (!btn || !this._state) return;

        const action = btn.dataset.quipsDsapAction;
        const { host, workspaceId } = this._state;

        if (action === 'view') {
            host.navigate(`dsap://${QUIPS_DSAP_URL}/${encodeURIComponent(workspaceId)}/phrasebook`);
            return;
        }

        if (action === 'settings') {
            host.navigate(`dsap://${QUIPS_DSAP_URL}/${encodeURIComponent(workspaceId)}/settings`);
            return;
        }

        if (action === 'extract') {
            // startGenerationQuipsExtractForWorkspace: public/scripts/comp/generationQuipsTray.js
            if (typeof startGenerationQuipsExtractForWorkspace === 'function') {
                await startGenerationQuipsExtractForWorkspace(workspaceId);
                await this._refreshStatus();
                this._renderStats();
                this._renderStatusCard();
            }
            return;
        }

        if (action === 'clear') {
            // clearGenerationQuipsForWorkspace: public/scripts/comp/generationQuipsTray.js
            if (typeof clearGenerationQuipsForWorkspace === 'function') {
                await clearGenerationQuipsForWorkspace(workspaceId);
                await this._refreshStatus();
                this._renderStats();
                this._renderStatusCard();
            }
            return;
        }

        if (action === 'refresh-cache') {
            // loadDynamicGenerationQuips: public/scripts/comp/generationQuips.js
            if (typeof loadDynamicGenerationQuips === 'function') {
                const result = await loadDynamicGenerationQuips(true);
                if (!result?.ok) {
                    if (typeof showQuipsErrorDialog === 'function') {
                        showQuipsErrorDialog('Quips Cache', result?.error || 'Could not refresh quips cache');
                    }
                } else if (typeof showGlassToast === 'function') {
                    showGlassToast(
                        'success',
                        'Quips cache',
                        result.unchanged ? 'Phrase book is already up to date' : 'Client phrase book updated',
                        false,
                        4000,
                        '<i class="fas fa-download"></i>'
                    );
                }
                await this._refreshStatus();
                this._renderStatusCard();
            }
            return;
        }

        if (action === 'generate') {
            if (typeof isQuipsPipelineRunning === 'function' && isQuipsPipelineRunning()) {
                host.showToast('info', 'Generate quips', 'Generation is already running', false, 4000, '<i class="fas fa-comment-dots"></i>');
                return;
            }

            const draft = this._state.settingsDraft;
            if (quipsDsapIsSettingsView(host) && draft && window.wsClient?.isConnected()) {
                try {
                    const result = await window.wsClient.runGenerationQuips({
                        scope: 'workspace',
                        workspaceId,
                        termLimit: draft.termLimit,
                        grokBatchSize: draft.grokBatchSize,
                        phrasesPerTerm: draft.phrasesPerTerm
                    });
                    if (result?.started === false) {
                        host.showToast('info', 'Generate quips', result.message || 'Generation already in progress', false, 4000, '<i class="fas fa-comment-dots"></i>');
                        return;
                    }
                    // markQuipsGenerationRunStarted: public/scripts/comp/generationQuipsTray.js
                    if (typeof markQuipsGenerationRunStarted === 'function') {
                        markQuipsGenerationRunStarted();
                    }
                } catch (error) {
                    host.showToast('error', 'Generate quips', error.message || 'Failed to start generation', false, 6000, '<i class="fas fa-exclamation-circle"></i>');
                }
            } else if (typeof startGenerationQuipsScanForWorkspace === 'function') {
                await startGenerationQuipsScanForWorkspace(workspaceId);
            }

            await this._refreshStatus();
            this._renderStatusCard();
            this._renderProgress();
            return;
        }
    }
};

function registerQuipsDsapApplet() {
    // registerDsap: public/scripts/comp/dsapRegistry.js
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: QUIPS_DSAP_URL,
        getContent(match) {
            const hostStub = {
                getPathSegments() {
                    const norm = typeof normalizeDsapUrlInput === 'function'
                        ? normalizeDsapUrlInput(match.canonicalUrl)
                        : match.canonicalUrl;
                    const base = QUIPS_DSAP_URL;
                    if (!norm.startsWith(base)) return [];
                    const rest = norm.slice(base.length).replace(/^\//, '');
                    const pathOnly = rest.split('?')[0];
                    return pathOnly ? pathOnly.split('/').filter(Boolean) : [];
                },
                getQueryParam() { return null; }
            };

            const workspaceId = quipsDsapResolveWorkspaceId(hostStub);
            const wsLabel = quipsDsapWorkspaceLabel(workspaceId, null);

            if (quipsDsapIsPhrasebookView(hostStub)) {
                return {
                    html: quipsDsapBuildPhrasebookHtml(`${wsLabel} — phrase book`),
                    css: quipsDsapScopedCss,
                    drivers: quipsDsapDriver,
                    baseBackground: '#eeeeee'
                };
            }

            if (quipsDsapIsSettingsView(hostStub)) {
                return {
                    html: quipsDsapBuildSettingsHtml(workspaceId, wsLabel),
                    css: quipsDsapScopedCss,
                    drivers: quipsDsapDriver,
                    baseBackground: '#eeeeee'
                };
            }

            return {
                html: quipsDsapBuildDashboardHtml(workspaceId, wsLabel),
                css: quipsDsapScopedCss,
                drivers: quipsDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerQuipsDsapApplet();
