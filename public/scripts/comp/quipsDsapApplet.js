/**
 * Dynamic Quips DSAP — dashboard at quips.dyna.dreamscape.jp
 * Depends on: dsapRegistry.js, generationQuipsTray.js, generationQuips.js, dropdown.js, confirmationDialog.js
 */

const QUIPS_DSAP_URL = 'quips.dyna.dreamscape.jp';
const QUIPS_DSAP_TITLE = 'Dynamic Quips';
const QUIPS_DSAP_TAB_LABELS = {
    status: 'Status',
    phrasebook: 'Phrase Book',
    configuration: 'Configuration'
};
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

function quipsDsapResolveActiveTab(host) {
    if (quipsDsapIsPhrasebookView(host)) return 'phrasebook';
    if (quipsDsapIsSettingsView(host)) return 'configuration';
    return 'status';
}

function quipsDsapBuildTabBar(activeTabId) {
    // dsapSmfBuildTabBar: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildTabBar([
        { id: 'status', label: 'Status', icon: 'fas fa-gauge-high' },
        { id: 'phrasebook', label: 'Phrase Book', icon: 'fas fa-book' },
        { id: 'configuration', label: 'Configuration', icon: 'fas fa-sliders' }
    ], activeTabId, { tabBarId: 'quipsDsapTabBar', dataAttr: 'data-quips-tab' });
}

function quipsDsapBuildSmfChrome(activeTabId) {
    // dsapSmfBuildHeader: public/scripts/comp/dsapSmfMarkup.js
    return dsapSmfBuildHeader({
        branchTitle: DSAP_SMF_BRANCH_IMAGE_GEN,
        toolTitle: 'Quips'
    }) + quipsDsapBuildTabBar(activeTabId);
}

function quipsDsapBuildDashboardHtml(workspaceId, wsLabel) {
    const safeLabel = quipsDsapEscapeHtml(wsLabel);
    const safeWs = quipsDsapEscapeAttr(workspaceId);
    return `
<div data-dsap="quips-dyna" class="dsap-root dsap-smf quips-dsap">
${quipsDsapBuildSmfChrome('status')}
${dsapSmfBuildContextBar(`Workspace: <b>${safeLabel}</b>`)}

<table class="quips-dsap-stats dsap-smf-stats" id="quipsDsapStatsGrid" cellspacing="0" cellpadding="3" width="100%" border="1">
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

<div class="quips-dsap-actions dsap-smf-toolbar">
  <div class="quips-dsap-workspace-picker">
    <label class="quips-dsap-workspace-label" for="quipsDsapWorkspaceBtn">Workspace:</label>
    <button type="button" id="quipsDsapWorkspaceBtn" class="dsap-smf-btn dsap-smf-btn-small quips-dsap-workspace-btn">
      <span id="quipsDsapWorkspaceSelected">${safeLabel}</span> <i class="fas fa-caret-down"></i>
    </button>
    <input type="hidden" id="quipsDsapWorkspaceHidden" value="${safeWs}">
  </div>
  <button type="button" class="quips-dsap-action-btn dsap-smf-btn dsap-smf-btn-primary quips-btn-primary" data-quips-dsap-action="generate"><i class="fas fa-wand-magic-sparkles"></i> Generate</button>
</div>

<div class="quips-dsap-previews hidden" id="quipsDsapPreviews"></div>
</div>`;
}

function quipsDsapBuildPhrasebookHtml(title) {
    const safeTitle = quipsDsapEscapeHtml(title || 'Phrase book');
    return `
<div data-dsap="quips-dyna" class="dsap-root dsap-smf quips-dsap quips-dsap-phrasebook">
${quipsDsapBuildSmfChrome('phrasebook')}
<div class="quips-dsap-phrasebook-toolbar dsap-smf-toolbar">
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
<div data-dsap="quips-dyna" class="dsap-root dsap-smf quips-dsap quips-dsap-settings">
${quipsDsapBuildSmfChrome('configuration')}
<div class="quips-dsap-phrasebook-toolbar dsap-smf-toolbar">
  <span class="quips-dsap-phrasebook-title">Settings — ${safeLabel}</span>
</div>

<p class="quips-dsap-settings-intro">Configure automatic scans and generation parameters for this workspace. Changes save immediately.</p>

<table class="quips-dsap-settings-table" cellspacing="0" cellpadding="4" border="0" width="100%">
  <tr>
    <td class="quips-dsap-setting-label">Automatic updates</td>
    <td>
      <button type="button" id="quipsDsapScheduleBtn" class="dsap-smf-btn dsap-smf-btn-small quips-dsap-setting-menu-btn">
        <span id="quipsDsapScheduleSelected">Loading…</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="quipsDsapScheduleHidden" value="disabled">
    </td>
    <td class="quips-dsap-setting-hint-cell"><span id="quipsDsapLastRunHint"></span></td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Terms to rank</td>
    <td>
      <button type="button" id="quipsDsapTermLimitBtn" class="dsap-smf-btn dsap-smf-btn-small quips-dsap-setting-menu-btn">
        <span id="quipsDsapTermLimitSelected">50</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="quipsDsapTermLimitHidden" value="50">
    </td>
    <td class="quips-dsap-setting-hint-cell">How many prompt terms to extract and rank per scan</td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Terms per Grok batch</td>
    <td>
      <button type="button" id="quipsDsapGrokBatchBtn" class="dsap-smf-btn dsap-smf-btn-small quips-dsap-setting-menu-btn">
        <span id="quipsDsapGrokBatchSelected">3</span> <i class="fas fa-caret-down"></i>
      </button>
      <input type="hidden" id="quipsDsapGrokBatchHidden" value="3">
    </td>
    <td class="quips-dsap-setting-hint-cell">How many ranked terms to send per Grok request</td>
  </tr>
  <tr>
    <td class="quips-dsap-setting-label">Quips per term</td>
    <td>
      <button type="button" id="quipsDsapPhrasesPerTermBtn" class="dsap-smf-btn dsap-smf-btn-small quips-dsap-setting-menu-btn">
        <span id="quipsDsapPhrasesPerTermSelected">15</span> <i class="fas fa-caret-down"></i>
      </button>
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

/* Shared chrome (header, tabs, stats, buttons) lives in public/css/dsap-smf.css */

[data-dsap="quips-dyna"] .quips-dsap-stat-value {
  word-break: break-word;
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

[data-dsap="quips-dyna"] .quips-dsap-workspace-picker {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
}
[data-dsap="quips-dyna"] .quips-dsap-workspace-label {
  font-size: 11pt;
  color: #111111;
  font-weight: bold;
  white-space: nowrap;
}
[data-dsap="quips-dyna"] .quips-dsap-workspace-picker .custom-dropdown {
  min-width: 140px;
  max-width: 240px;
}
[data-dsap="quips-dyna"] .quips-dsap-actions [data-quips-dsap-action="generate"] {
  margin-left: auto;
  flex: 0 0 auto;
  min-width: 9em;
  padding-left: 18px;
  padding-right: 18px;
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
    _settingsDropdownScopeRegistered: false,
    _clickMenuTargets: [],

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

        this._wireSettingsDropdownModalScope(host);
        this._wireQuipsTabs(root, host);

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
        this._teardownClickMenus();

        if (window.wsClient && typeof window.wsClient.off === 'function') {
            state.wsHandlers.forEach(({ event, fn }) => window.wsClient.off(event, fn));
        }
        this._state = null;
        this._settingsDropdownScopeRegistered = false;
    },

    _wireQuipsTabs(root, host) {
        // dsapSmfWireTabBar: public/scripts/comp/dsapSmfMarkup.js
        dsapSmfWireTabBar(root, '#quipsDsapTabBar', 'data-quips-tab', (tabId) => {
            const workspaceId = this._state?.workspaceId || quipsDsapResolveWorkspaceId(host);
            const ws = encodeURIComponent(workspaceId);
            if (tabId === 'phrasebook') return `dsap://${QUIPS_DSAP_URL}/${ws}/phrasebook`;
            if (tabId === 'configuration') return `dsap://${QUIPS_DSAP_URL}/${ws}/settings`;
            return `dsap://${QUIPS_DSAP_URL}/${ws}`;
        }, host);
    },

    _getHostModal(host) {
        return host?.shell?.modal || null;
    },

    _teardownSettingsDropdowns(host) {
        const root = host?.getRoot?.();
        if (!root || typeof teardownDropdown !== 'function') return;
        root.querySelectorAll('.custom-dropdown').forEach((el) => teardownDropdown(el));
    },

    _wireSettingsDropdownModalScope(host) {
        const modal = this._getHostModal(host);
        if (!modal || this._settingsDropdownScopeRegistered) return;
        this._settingsDropdownScopeRegistered = true;
        if (!this._quipsModalScopeHandler) {
            this._quipsModalScopeHandler = (signal) => {
                const activeHost = this._state?.host;
                signal.addEventListener('abort', () => {
                    if (activeHost) {
                        this._teardownSettingsDropdowns(activeHost);
                    }
                }, { once: true });
                if (activeHost && quipsDsapIsSettingsView(activeHost) && this._state?.settingsDraft) {
                    this._wireSettingsDropdowns();
                }
            };
        }
        attachModalListeners(modal, this._quipsModalScopeHandler);
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

        this._wireSettingsClickMenus();
    },

    _teardownClickMenus() {
        // contextMenu.detachClickMenuFromElement: public/scripts/comp/contextMenu.js
        if (!contextMenu || !this._clickMenuTargets.length) {
            this._clickMenuTargets = [];
            return;
        }
        this._clickMenuTargets.forEach((el) => contextMenu.detachClickMenuFromElement(el));
        this._clickMenuTargets = [];
    },

    _attachQuipsClickMenu(btn, config) {
        if (!btn || !contextMenu) return;
        contextMenu.attachClickMenuToElement(btn, config);
        this._clickMenuTargets.push(btn);
    },

    _wireSimpleSettingDropdown(config) {
        /* replaced by _wireSettingsClickMenus */
    },

    _wireNumericSettingDropdown(config) {
        /* replaced by _wireSettingsClickMenus */
    },

    _wireSettingsClickMenus() {
        const root = this._state?.host?.getRoot();
        const draft = this._state?.settingsDraft;
        if (!root || !draft || !contextMenu) return;
        this._teardownClickMenus();

        const scheduleBtn = root.querySelector('#quipsDsapScheduleBtn');
        const scheduleSelected = root.querySelector('#quipsDsapScheduleSelected');
        const scheduleHidden = root.querySelector('#quipsDsapScheduleHidden');
        if (scheduleBtn && scheduleHidden) {
            scheduleHidden.value = draft.schedule || 'disabled';
            if (scheduleSelected) {
                scheduleSelected.textContent = typeof getQuipsAutoScheduleLabel === 'function'
                    ? getQuipsAutoScheduleLabel(draft.schedule || 'disabled')
                    : (draft.schedule || 'disabled');
            }
            const scheduleConfig = {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 360,
                beforeShow: () => {
                    const current = scheduleHidden.value || 'disabled';
                    const items = [];
                    if (typeof buildQuipsAutoScheduleDropdownGroups === 'function') {
                        buildQuipsAutoScheduleDropdownGroups().forEach((group) => {
                            (group.options || []).forEach((opt) => {
                                items.push({
                                    text: opt.label || opt.value,
                                    action: 'select-schedule',
                                    scheduleValue: opt.value,
                                    loadfn: (item) => {
                                        item.highlighted = item.scheduleValue === current;
                                    }
                                });
                            });
                        });
                    }
                    scheduleConfig.sections[0].items = items;
                },
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    if (action !== 'select-schedule') return;
                    draft.schedule = item.scheduleValue;
                    draft.enabled = item.scheduleValue !== 'disabled';
                    scheduleHidden.value = item.scheduleValue;
                    if (scheduleSelected) {
                        scheduleSelected.textContent = typeof getQuipsAutoScheduleLabel === 'function'
                            ? getQuipsAutoScheduleLabel(item.scheduleValue)
                            : item.text;
                    }
                    this._persistSettingsDraft();
                }
            };
            this._attachQuipsClickMenu(scheduleBtn, scheduleConfig);
        }

        const numericMenus = [
            { btnId: 'quipsDsapTermLimitBtn', hiddenId: 'quipsDsapTermLimitHidden', selectedId: 'quipsDsapTermLimitSelected', options: QUIPS_TERM_LIMIT_OPTIONS, field: 'termLimit' },
            { btnId: 'quipsDsapGrokBatchBtn', hiddenId: 'quipsDsapGrokBatchHidden', selectedId: 'quipsDsapGrokBatchSelected', options: QUIPS_GROK_BATCH_OPTIONS, field: 'grokBatchSize' },
            { btnId: 'quipsDsapPhrasesPerTermBtn', hiddenId: 'quipsDsapPhrasesPerTermHidden', selectedId: 'quipsDsapPhrasesPerTermSelected', options: QUIPS_PHRASES_PER_TERM_OPTIONS, field: 'phrasesPerTerm' }
        ];
        numericMenus.forEach((spec) => {
            const btn = root.querySelector(`#${spec.btnId}`);
            const hidden = root.querySelector(`#${spec.hiddenId}`);
            const selected = root.querySelector(`#${spec.selectedId}`);
            if (!btn || !hidden) return;
            hidden.value = String(draft[spec.field]);
            if (selected) selected.textContent = String(draft[spec.field]);
            const config = {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 260,
                beforeShow: () => {
                    const current = hidden.value;
                    config.sections[0].items = spec.options.map((n) => ({
                        text: String(n),
                        action: 'select-numeric-setting',
                        numericValue: n,
                        field: spec.field,
                        loadfn: (item) => {
                            item.highlighted = String(item.numericValue) === current;
                        }
                    }));
                },
                sections: [{ type: 'list', items: [] }],
                onAction: (action, target, item) => {
                    if (action !== 'select-numeric-setting') return;
                    draft[item.field] = item.numericValue;
                    hidden.value = String(item.numericValue);
                    if (selected) selected.textContent = String(item.numericValue);
                    this._persistSettingsDraft();
                }
            };
            this._attachQuipsClickMenu(btn, config);
        });
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
        const btn = root.querySelector('#quipsDsapWorkspaceBtn');
        const selectedEl = root.querySelector('#quipsDsapWorkspaceSelected');
        const hidden = root.querySelector('#quipsDsapWorkspaceHidden');
        if (!btn || !selectedEl || !hidden || !contextMenu) return;

        const wsList = (status?.workspaces || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (!wsList.length && typeof workspaces !== 'undefined') {
            Object.entries(workspaces).forEach(([id, ws]) => {
                wsList.push({ id, name: ws.name || id });
            });
        }

        const config = {
            position: 'anchor',
            anchorAlign: 'start',
            maxHeight: 360,
            beforeShow: () => {
                const current = hidden.value || workspaceId;
                config.sections[0].items = wsList.map((w) => ({
                    text: w.name || w.id,
                    action: 'select-quips-workspace',
                    workspaceValue: w.id,
                    loadfn: (item) => {
                        item.highlighted = item.workspaceValue === current;
                    }
                }));
            },
            sections: [{ type: 'list', items: [] }],
            onAction: (action, target, item) => {
                if (action !== 'select-quips-workspace') return;
                hidden.value = item.workspaceValue;
                selectedEl.textContent = quipsDsapWorkspaceLabel(item.workspaceValue, status);
                host.navigate(`dsap://${QUIPS_DSAP_URL}/${encodeURIComponent(item.workspaceValue)}`);
            }
        };
        this._attachQuipsClickMenu(btn, config);
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
        theme: 'dsap-smf',
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
