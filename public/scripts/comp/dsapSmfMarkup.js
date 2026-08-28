/**
 * DSAP-SMF (Simple Management Framework) — shared markup builders for retro Linksys-style DSAP applets.
 * Depends on: dsapRegistry.js (optional, for theme loading)
 *
 * See .cursor/rules/dsap-smf-design.mdc
 */

const DSAP_SMF_BRANCH_ENSHUTSUKA = 'Enshutsuka';
const DSAP_SMF_BRANCH_SECURITY = 'Security Center';
const DSAP_SMF_BRANCH_DATA_MGMT = 'Data Management';
const DSAP_SMF_BRANCH_IMAGE_GEN = 'Image Generation';
const DSAP_SMF_BRANCH_DREAMSCAPE = 'Dreamscape';
const DSAP_SMF_BRANCH_AUTOFILL = 'Autofill Ranking';
const DSAP_SMF_BRANCH_WIKI = 'Wiki Manager';

const DSAP_SMF_DEFAULT_LOGO = '/static_images/logo_icon.png';

function dsapSmfEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function dsapSmfEscapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;');
}

/**
 * Two-column header: branch/system name (left) | active tab name (right).
 * @param {{ branchTitle: string, toolTitle: string, logoSrc?: string, toolTitleId?: string }} opts
 */
function dsapSmfBuildHeader(opts) {
    const branchTitle = dsapSmfEscapeHtml(opts.branchTitle || '');
    const toolTitle = dsapSmfEscapeHtml(opts.toolTitle || opts.toolName || '');
    const logoSrc = dsapSmfEscapeAttr(opts.logoSrc || DSAP_SMF_DEFAULT_LOGO);
    const toolTitleId = opts.toolTitleId || opts.headerRightId || 'dsapSmfHeaderTool';
    const rightId = toolTitleId ? ` id="${dsapSmfEscapeAttr(toolTitleId)}"` : '';
    return `<table class="dsap-smf-header" cellspacing="0" cellpadding="6" width="100%" border="0">
  <tr>
    <td class="dsap-smf-header-branch">
      <img src="${logoSrc}" alt="Dreamscape" class="dsap-smf-header-logo">
      <span class="dsap-smf-header-branch-title">${branchTitle}</span>
    </td>
    <td class="dsap-smf-header-tool" align="right"${rightId}>${toolTitle}</td>
  </tr>
</table>`;
}

/** Update the right header cell (active tab label). */
function dsapSmfUpdateHeaderTool(dsapRoot, toolTitle, toolTitleId) {
    const id = toolTitleId || 'dsapSmfHeaderTool';
    let el = null;
    if (dsapRoot && dsapRoot.nodeType === 1) {
        el = dsapRoot.querySelector(`#${id}`);
    } else if (typeof dsapRoot === 'string') {
        const root = document.querySelector(`[data-dsap="${dsapRoot}"]`);
        el = root ? root.querySelector(`#${id}`) : null;
    }
    if (!el) el = document.getElementById(id);
    if (el) el.textContent = String(toolTitle || '');
}

/**
 * Table-based tab bar (canonical SMF pattern — matches Security Center).
 * @param {Array<{ id: string, label: string, icon?: string, autoWidth?: boolean }>} tabs
 * @param {string} activeTabId
 * @param {{ tabBarId?: string, dataAttr?: string, tabClass?: string }} [options]
 */
function dsapSmfBuildTabBar(tabs, activeTabId, options) {
    const opts = options || {};
    const tabBarId = opts.tabBarId ? ` id="${dsapSmfEscapeAttr(opts.tabBarId)}"` : '';
    const dataAttr = opts.dataAttr || 'data-dsap-smf-tab';
    const tabClass = opts.tabClass || 'dsap-smf-tab';
    const cells = (tabs || []).map((tab) => {
        const active = tab.id === activeTabId ? ` ${tabClass}-active active` : '';
        const autoCls = tab.autoWidth ? ' dsap-smf-tab-auto' : '';
        const icon = tab.icon ? `<i class="${dsapSmfEscapeAttr(tab.icon)}"></i> ` : '';
        return `<td align="center" class="${tabClass}${active}${autoCls}" ${dataAttr}="${dsapSmfEscapeAttr(tab.id)}">${icon}${dsapSmfEscapeHtml(tab.label)}</td>`;
    }).join('\n    ');
    return `<table class="dsap-smf-tabbar" cellspacing="0" cellpadding="3" border="1" width="100%"${tabBarId}>
  <tr>
    ${cells}
  </tr>
</table>`;
}

/** Context / subtitle bar below tabs (workspace label, scope hint, etc.) */
function dsapSmfBuildContextBar(html) {
    return `<div class="dsap-smf-contextbar">${html || ''}</div>`;
}

/** Toolbar row for active tab controls (search, filters, actions) */
function dsapSmfBuildToolbar(html, toolbarId) {
    const id = toolbarId ? ` id="${dsapSmfEscapeAttr(toolbarId)}"` : '';
    return `<div class="dsap-smf-toolbar"${id}>${html || ''}</div>`;
}

/**
 * @param {Array<{ label: string, valueHtml: string, width?: string }>} cells
 */
function dsapSmfBuildStatsTable(cells, tableId) {
    const id = tableId ? ` id="${dsapSmfEscapeAttr(tableId)}"` : '';
    const tds = (cells || []).map((cell, idx, arr) => {
        const width = cell.width ? ` width="${dsapSmfEscapeAttr(cell.width)}"` : '';
        const w = width || (arr.length === 3 ? ` width="${Math.floor(100 / arr.length)}%"` : '');
        return `<td align="center"${w}><span class="dsap-smf-stat-label">${dsapSmfEscapeHtml(cell.label)}</span><br><span class="dsap-smf-stat-value">${cell.valueHtml || '—'}</span></td>`;
    }).join('\n    ');
    return `<table class="dsap-smf-stats"${id} cellspacing="0" cellpadding="3" width="100%" border="1">
  <tr>
    ${tds}
  </tr>
</table>`;
}

function dsapSmfBuildSectionHdr(text, sectionId) {
    const id = sectionId ? ` id="${dsapSmfEscapeAttr(sectionId)}"` : '';
    return `<div class="dsap-smf-section-hdr"${id}>${dsapSmfEscapeHtml(text || '')}</div>`;
}

function dsapSmfBuildStatusBox(messageHtml, boxId, messageId) {
    const boxAttr = boxId ? ` id="${dsapSmfEscapeAttr(boxId)}"` : '';
    const msgAttr = messageId ? ` id="${dsapSmfEscapeAttr(messageId)}"` : '';
    return `<div class="dsap-smf-statusbox"${boxAttr}>
  <span class="dsap-smf-status-message"${msgAttr}>${messageHtml || ''}</span>
</div>`;
}

function dsapSmfBuildRootOpen(dataDsapId, extraClasses) {
    const extra = extraClasses ? ` ${extraClasses}` : '';
    return `<div data-dsap="${dsapSmfEscapeAttr(dataDsapId)}" class="dsap-root dsap-smf${extra}">`;
}

function dsapSmfBuildRootClose() {
    return '</div>';
}

/** Wire table tab bar clicks to host.navigate(urlBuilder(tabId)). */
function dsapSmfWireTabBar(root, tabBarSelector, dataAttr, urlBuilder, host) {
    const tabBar = root.querySelector(tabBarSelector);
    if (!tabBar || tabBar.dataset.dsapSmfWired === '1') return;
    tabBar.dataset.dsapSmfWired = '1';
    tabBar.addEventListener('click', (e) => {
        const tab = e.target.closest(`[${dataAttr}]`);
        if (!tab) return;
        const tabId = tab.getAttribute(dataAttr);
        const url = urlBuilder(tabId);
        if (url && host && typeof host.navigate === 'function') {
            host.navigate(url);
        }
    });
}

function dsapSmfSetActiveTab(root, dataAttr, activeTabId, tabClass) {
    const cls = tabClass || 'dsap-smf-tab';
    root.querySelectorAll(`[${dataAttr}]`).forEach((tab) => {
        const on = tab.getAttribute(dataAttr) === activeTabId;
        tab.classList.toggle(cls + '-active', on);
        tab.classList.toggle('active', on);
    });
}

function dsapSmfBuildDreamscapeHomeHtml() {
    const links = [
        { url: 'dsap://data.dreamscape.jp/', label: 'Data Management', icon: 'fas fa-database', desc: 'Manage workspaces, data, and files' },
        { url: 'dsap://ispy.dreamscape.jp/', label: 'Global Search', icon: 'fas fa-search', desc: 'Search prompts and metadata across workspace corpora' },
        { url: 'dsap://security.dreamscape.jp/', label: 'Security Center', icon: 'fas fa-shield-halved', desc: 'Blocked clients, honeypot URLs, authentication, and telemetry', admin: true },
        { url: 'dsap://autofill.dreamscape.jp/', label: 'Autofill Ranking', icon: 'fas fa-arrow-down-wide-short', desc: 'Tune SmartText/autofill scoring weights, match tiers, and type priority', admin: true },
        { url: 'dsap://memories.dyna.dreamscape.jp/', label: 'Enshutsuka', icon: 'fas fa-lightbulb-on', desc: 'Director knowledge memories, static rules, and LinkXi persona' },
        { url: 'dsap://quips.dyna.dreamscape.jp/', label: 'Generation Quips', icon: 'fas fa-comment-heart', desc: 'Generation quips dashboard, phrase book, and workspace settings' },
    ];

    const rows = links.map((link) => {
        const adminBadge = link.admin ? ' <span class="dsap-smf-home-admin">Admin</span>' : '';
        return `<tr>
  <td class="dsap-smf-home-link-cell">
    <a href="${dsapSmfEscapeAttr(link.url)}" class="dsap-smf-home-link" data-dsap-smf-home-link="${dsapSmfEscapeAttr(link.url)}">
      <i class="${dsapSmfEscapeAttr(link.icon)}"></i> <strong>${dsapSmfEscapeHtml(link.label)}</strong>${adminBadge}
    </a>
    <div class="dsap-smf-home-desc">${dsapSmfEscapeHtml(link.desc)}</div>
  </td>
</tr>`;
    }).join('\n');

    return `${dsapSmfBuildRootOpen('dreamscape-home')}
${dsapSmfBuildHeader({ branchTitle: DSAP_SMF_BRANCH_DREAMSCAPE, toolTitle: 'Home' })}
${dsapSmfBuildSectionHdr('Control Panel')}
<table class="dsap-smf-home-table" cellspacing="0" cellpadding="6" width="100%" border="0">
  ${rows}
</table>
<p class="dsap-smf-home-foot">Dreamscape System Control Panel</p>
${dsapSmfBuildRootClose()}`;
}
