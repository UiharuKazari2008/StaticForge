/**
 * Knowledge Memories DSAP Applet — memories.dyna.dreamscape.jp
 * Retro web 1.5 / basic Linksys-style UI (early 2000s admin panel) to match the Quips DSAP.
 * Includes Static Director Rules + Feedback as a sub-view.
 *
 * Depends on: dsapRegistry.js (for registerDsap + host), wsClient, showGlassToast, showConfirmationDialog, dropdown utils (optional)
 */

const MEMORIES_DSAP_URL = 'memories.dyna.dreamscape.jp';
const MEMORIES_DSAP_TITLE = 'Knowledge Memories';
const MEMORIES_DEFAULT_PER_PAGE = 25;
const MEMORIES_PER_PAGE_OPTIONS = [10, 25, 50, 100];

function memoriesDsapDecodeSegment(segment) {
    if (!segment) return segment;
    try { return decodeURIComponent(segment); } catch (e) { return segment; }
}

/** Build a canonical list URL carrying the current list filters/page (for history + back buttons) */
function memoriesDsapBuildListUrl({ page = 1, perPage = MEMORIES_DEFAULT_PER_PAGE, search = '', category = '' } = {}) {
    const q = new URLSearchParams();
    if (page && page > 1) q.set('page', String(page));
    if (perPage && perPage !== MEMORIES_DEFAULT_PER_PAGE) q.set('perPage', String(perPage));
    if (search) q.set('search', search);
    if (category) q.set('category', category);
    const qs = q.toString();
    return qs ? `dsap://${MEMORIES_DSAP_URL}/?${qs}` : `dsap://${MEMORIES_DSAP_URL}/`;
}

/** Build a detail URL. We carry current list context in the query so "Back to list" can restore it. */
function memoriesDsapBuildDetailUrl(name, listContext = null) {
    let base = `dsap://${MEMORIES_DSAP_URL}/view/${encodeURIComponent(name)}`;
    if (listContext) {
        const q = new URLSearchParams();
        if (listContext.page && listContext.page > 1) q.set('page', String(listContext.page));
        if (listContext.perPage && listContext.perPage !== MEMORIES_DEFAULT_PER_PAGE) q.set('perPage', String(listContext.perPage));
        if (listContext.search) q.set('search', listContext.search);
        if (listContext.category) q.set('category', listContext.category);
        const qs = q.toString();
        if (qs) base += `?${qs}`;
    }
    return base;
}

function memoriesDsapEscapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function memoriesDsapEscapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;');
}

function memoriesDsapFormatDate(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    if (isNaN(date.getTime())) return 'Invalid date';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

function memoriesDsapBuildMemoriesHtml() {
    return `
<div data-dsap="memories-dyna" class="dsap-root memories-dsap">
<table class="memories-dsap-header" cellspacing="0" cellpadding="6" width="100%" border="0">
  <tr>
    <td class="memories-dsap-header-left">
      <img src="/static_images/logo_icon.png" alt="Dreamscape" style="height:32px; vertical-align:middle; margin-right:8px;">
      <span class="memories-dsap-header-title">Enshutsuka Configuration</span>
    </td>
    <td class="memories-dsap-header-right" align="right" id="memoriesHeaderRight">Data Management</td>
  </tr>
</table>

    <div class="memories-toolbar">
        <div class="memories-search-wrap">
            <i class="fas fa-search memories-search-icon"></i>
            <input type="text" id="memoriesSearchInput" class="memories-search-input" placeholder="Search memories by name or description...">
        </div>
        <div class="memories-filter-wrap" id="memoriesCategoryFilterWrap">
            <button type="button" id="memoriesCategoryBtn" class="memories-filter-btn" title="Filter by category">
                <i class="fas fa-filter"></i>
                <span id="memoriesCategoryLabel">All Categories</span>
                <i class="fas fa-caret-down"></i>
            </button>
            <div id="memoriesCategoryMenu" class="memories-dropdown-menu hidden"></div>
        </div>
        <button type="button" id="memoriesStaticRulesBtn" class="memories-btn memories-btn-secondary" title="Open Static Director Rules (and Feedback)">
            <i class="fas fa-book-law"></i> <span>Static Rules</span>
        </button>
    </div>

    <table class="memories-stats-bar" id="memoriesStatsBar" cellspacing="0" cellpadding="3" border="1" width="100%" style="border-collapse:collapse; background:#fff;">
  <tr>
    <td align="center"><i class="fas fa-lightbulb-on"></i> <span id="memoriesStatTotal">0</span> memories</td>
    <td align="center"><i class="fas fa-cubes"></i> <span id="memoriesStatEntities">0</span> entities</td>
    <td align="center"><i class="fas fa-project-diagram"></i> <span id="memoriesStatRelations">0</span> relations</td>
  </tr>
</table>

    <div class="memories-view memories-list-view" id="memoriesListView">
        <div id="memoriesLoading" class="memories-loading">
            <i class="fas fa-spinner-third fa-spin"></i>
            <span>Loading Knowledge memories...</span>
        </div>
        <div id="memoriesList" class="memories-list hidden"></div>
        <div id="memoriesEmpty" class="memories-empty hidden">
            <i class="fas fa-info-circle"></i>
            <span>No memories found</span>
        </div>

        <!-- Pager (2008 web 2.0 style) -->
        <div class="memories-pager" id="memoriesPager">
            <button type="button" class="memories-btn memories-btn-secondary memories-btn-small" data-pager="prev" title="Previous page">
                <i class="fas fa-chevron-left"></i> <span>Prev</span>
            </button>
            <div class="memories-pager-info">
                <span>Page <strong id="memoriesPagerPage">1</strong> / <span id="memoriesPagerTotalPages">1</span></span>
                <span class="memories-pager-range">(<span id="memoriesPagerRange">0-0</span> of <span id="memoriesPagerTotal">0</span>)</span>
            </div>
            <button type="button" class="memories-btn memories-btn-secondary memories-btn-small" data-pager="next" title="Next page">
                <span>Next</span> <i class="fas fa-chevron-right"></i>
            </button>
            <div class="memories-perpage">
                <label for="memoriesPerPageBtn">per page</label>
                <div id="memoriesPerPageDropdown" class="custom-dropdown memories-perpage-dropdown">
                    <button type="button" id="memoriesPerPageBtn" class="custom-dropdown-btn hover-show colored memories-perpage-btn">
                        <span id="memoriesPerPageSelected">25</span>
                    </button>
                    <div id="memoriesPerPageMenu" class="custom-dropdown-menu hidden"></div>
                </div>
                <input type="hidden" id="memoriesPerPageHidden" value="25">
            </div>
        </div>
    </div>

    <div class="memories-view memories-details-view hidden" id="memoriesDetailsView">
        <div class="memories-details-toolbar">
            <div class="memories-details-title" id="memoriesDetailsTitle">Memory</div>
            <div class="memories-details-actions">
                <button type="button" id="memoriesEditBtn" class="memories-btn memories-btn-secondary memories-btn-small">
                    <i class="fas fa-edit"></i> <span>Edit</span>
                </button>
                <button type="button" id="memoriesSaveBtn" class="memories-btn memories-btn-primary memories-btn-small hidden">
                    <i class="fas fa-save"></i> <span>Save</span>
                </button>
                <button type="button" id="memoriesCancelBtn" class="memories-btn memories-btn-secondary memories-btn-small hidden">
                    Cancel
                </button>
                <button type="button" id="memoriesDeleteBtn" class="memories-btn memories-btn-danger memories-btn-small">
                    <i class="fas fa-trash"></i> <span>Delete</span>
                </button>
            </div>
        </div>

        <div class="memories-details-body">
            <!-- Basic Info -->
            <div class="memories-field">
                <div class="memories-field-label">Name</div>
                <div id="memoriesDetailName" class="memories-field-value"></div>
                <input type="text" id="memoriesDetailNameEdit" class="memories-input hidden" placeholder="Memory name">
            </div>

            <div class="memories-field">
                <div class="memories-field-label">Description</div>
                <div id="memoriesDetailDesc" class="memories-field-value memories-field-desc"></div>
                <textarea id="memoriesDetailDescEdit" class="memories-input memories-textarea hidden" placeholder="Description" style="min-height:400px;"></textarea>
            </div>

            <div class="memories-field-row">
                <div class="memories-field">
                    <div class="memories-field-label">Category</div>
                    <div id="memoriesDetailCategory" class="memories-field-value"></div>
                    <input type="text" id="memoriesDetailCategoryEdit" class="memories-input hidden" placeholder="Category">
                </div>
                <div class="memories-field">
                    <div class="memories-field-label">Confidence</div>
                    <div id="memoriesDetailConfidence" class="memories-field-value"></div>
                    <input type="number" id="memoriesDetailConfidenceEdit" class="memories-input hidden" min="0" max="1" step="0.01" placeholder="0.0–1.0">
                </div>
            </div>

            <div class="memories-field-row">
                <div class="memories-field">
                    <div class="memories-field-label">Usage Count</div>
                    <div id="memoriesDetailUsage" class="memories-field-value"></div>
                </div>
                <div class="memories-field">
                    <div class="memories-field-label">Last Used</div>
                    <div id="memoriesDetailLastUsed" class="memories-field-value"></div>
                </div>
            </div>

            <!-- Entities -->
            <div class="memories-section">
                <div class="memories-section-head">
                    <h4><i class="fas fa-cubes"></i> Entities</h4>
                    <button type="button" id="memoriesAddEntityBtn" class="memories-btn memories-btn-secondary memories-btn-tiny hidden">
                        <i class="fas fa-plus"></i> Add Entity
                    </button>
                </div>
                <div id="memoriesEntities" class="memories-entities"></div>
            </div>

            <!-- Relations -->
            <div class="memories-section">
                <div class="memories-section-head">
                    <h4><i class="fas fa-project-diagram"></i> Relations</h4>
                    <button type="button" id="memoriesAddRelationBtn" class="memories-btn memories-btn-secondary memories-btn-tiny hidden">
                        <i class="fas fa-plus"></i> Add Relation
                    </button>
                </div>
                <div id="memoriesRelations" class="memories-relations"></div>
            </div>

            <!-- Observations -->
            <div class="memories-section">
                <div class="memories-section-head">
                    <h4><i class="fas fa-eye"></i> Observations</h4>
                    <button type="button" id="memoriesAddObsBtn" class="memories-btn memories-btn-secondary memories-btn-tiny hidden">
                        <i class="fas fa-plus"></i> Add Observation
                    </button>
                </div>
                <div id="memoriesObservations" class="memories-observations"></div>
            </div>
        </div>
    </div>

    <!-- Bulk Delete Selector Page (opened from the Delete Memories button) -->
    <div class="memories-view memories-delete-view hidden" id="memoriesDeleteView">
        <div class="memories-delete-toolbar">
            <div class="memories-delete-title">
                <span>Bulk Delete Memories</span>
            </div>
        </div>

        <div class="memories-delete-warning">
            <i class="fas fa-exclamation-triangle"></i>
            <div>
                <strong>Permanent action.</strong> Deleted memories cannot be recovered.
                Choose a filter below to select which memories to remove in bulk.
            </div>
        </div>

        <div class="memories-delete-options" id="memoriesDeleteOptions">
            <div class="memories-delete-option" data-filter="low_confidence">
                <div class="memories-delete-opt-title">Low Confidence</div>
                <div class="memories-delete-opt-desc">Memories with confidence &lt; 30%</div>
            </div>
            <div class="memories-delete-option" data-filter="old_usage">
                <div class="memories-delete-opt-title">&gt;30 Days Unused</div>
                <div class="memories-delete-opt-desc">Last used more than 30 days ago</div>
            </div>
            <div class="memories-delete-option" data-filter="never_used">
                <div class="memories-delete-opt-title">Never Used</div>
                <div class="memories-delete-opt-desc">Memories with zero usage and no last-used date</div>
            </div>
            <div class="memories-delete-option" data-filter="everything">
                <div class="memories-delete-opt-title">Everything</div>
                <div class="memories-delete-opt-desc">All memories in the database (nuclear option)</div>
            </div>
        </div>

        <div class="memories-delete-count-panel" id="memoriesDeleteCountPanel">
            <div class="memories-delete-count-label">Matching memories</div>
            <div class="memories-delete-count-value" id="memoriesDeleteCountValue">—</div>
            <div class="memories-delete-count-desc" id="memoriesDeleteCountDesc">Select a filter above to count</div>
        </div>

        <div class="memories-delete-actions">
            <button type="button" id="memoriesDoBulkDeleteBtn" class="memories-btn memories-btn-danger" disabled>
                <i class="fas fa-trash"></i> <span>Delete matching memories</span>
            </button>
            <button type="button" id="memoriesDeleteCancelBtn" class="memories-btn memories-btn-secondary">
                Cancel
            </button>
        </div>
    </div>

    <!-- Static Rules (Director Rules + Feedback) hosted inside Memories DSAP -->
    <div class="memories-view memories-static-rules-view hidden" id="memoriesStaticRulesView">
        <div class="memories-static-rules-toolbar">
            <div class="memories-static-rules-title">
                <i class="fas fa-book-law"></i> <span id="memoriesStaticRulesTitle">Director Rules</span>
            </div>
            <button type="button" id="memoriesAddStaticRuleBtn" class="memories-btn memories-btn-primary memories-btn-small" title="Add New Rule">
                <i class="fas fa-plus"></i> <span>Add</span>
            </button>
            <div class="memories-static-rules-switcher">
                <button type="button" class="memories-btn memories-btn-secondary memories-btn-small" data-rules-view="rules">Rules</button>
                <button type="button" class="memories-btn memories-btn-secondary memories-btn-small" data-rules-view="feedback">Feedback</button>
            </div>
        </div>

        <div class="memories-static-rules-list-container" id="memoriesStaticRulesListContainer">
            <div id="memoriesStaticRulesList" class="memories-static-rules-list">
                <!-- Populated by driver -->
            </div>
        </div>

        <div class="memories-static-rules-hint">
            These are user-defined static rules (Director Rules) and AI feedback entries. Changes save automatically.
        </div>
    </div>

    <div class="memories-footer">
        <div class="memories-bulk">
            <div id="memoriesDeleteDropdown" class="memories-dropdown">
                <button type="button" id="memoriesBulkDeleteBtn" class="memories-btn memories-btn-danger memories-btn-small">
                    <i class="fas fa-trash"></i>
                    <span>Delete Memories...</span>
                </button>
                <div id="memoriesBulkMenu" class="memories-dropdown-menu hidden"></div>
            </div>
        </div>
        <div class="memories-hint">Enshutsuka • Data Management</div>
    </div>
</div>`;
}

const memoriesDsapScopedCss = `
[data-dsap="memories-dyna"].memories-dsap,
[data-dsap="memories-dyna"].memories-dsap *:not(i) {
  font-family: Arial, Helvetica, sans-serif !important;
}
[data-dsap="memories-dyna"].memories-dsap {
  background: #eeeeee;
  color: #000000;
  font-size: 12pt;
  line-height: 1.3;
  padding: 4px;
  box-sizing: border-box;
  border: 1px solid #666666;
}

/* Larger top header (matching Quips DSAP retro web 1.5 style) */
[data-dsap="memories-dyna"] .memories-dsap-header {
  background: #003366;
  color: #ffffff;
  border: 1px solid #000033;
  margin-bottom: 4px;
  min-height: 40px;
}
[data-dsap="memories-dyna"] .memories-dsap-header-left {
  padding: 5px 8px;
  vertical-align: middle;
}
[data-dsap="memories-dyna"] .memories-dsap-header-title {
  font-weight: bold;
  font-size: 13pt;
  vertical-align: middle;
}
[data-dsap="memories-dyna"] .memories-dsap-header-right {
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

/* Toolbar (retro Linksys style) */
[data-dsap="memories-dyna"] .memories-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: #f0f0f0;
  border: 1px solid #999;
  margin-bottom: 4px;
}
[data-dsap="memories-dyna"] .memories-toolbar #memoriesStaticRulesBtn {
  margin-left: auto !important;
}
[data-dsap="memories-dyna"] .memories-search-wrap {
  position: relative;
  flex: 1 1 200px;
  min-width: 160px;
}
[data-dsap="memories-dyna"] .memories-search-icon {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  color: #333;
  font-size: 11pt;
}
[data-dsap="memories-dyna"] .memories-search-input {
  width: 100%;
  padding: 3px 6px 3px 22px;
  background: #fff;
  border: 1px solid #666;
  color: #000;
  font-size: 11pt;
}
[data-dsap="memories-dyna"] .memories-search-input:focus {
  outline: 1px solid #003366;
}
[data-dsap="memories-dyna"] .memories-filter-wrap { position: relative; }
[data-dsap="memories-dyna"] .memories-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: #d4d0c8;
  border: 1px solid #666;
  color: #000;
  font-size: 9pt;
  cursor: pointer;
}
[data-dsap="memories-dyna"] .memories-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: #c0c0c0;
  color: #000;
  border: 1px solid #ff8c00;
  border-radius: 3px;
  font-size: 10pt;
  cursor: pointer;
  box-shadow: 1px 1px 0 #ffffff inset, -1px -1px 0 #808080 inset;
}
[data-dsap="memories-dyna"] .memories-btn:active {
  box-shadow: -1px -1px 0 #ffffff inset, 1px 1px 0 #808080 inset;
  background: #b0b0b0;
}
[data-dsap="memories-dyna"] .memories-btn-secondary {
  background: #d4d0c8;
}
[data-dsap="memories-dyna"] .memories-btn-primary {
  background: #d4d8e0;
  border: 2px solid #ff8c00;
}
[data-dsap="memories-dyna"] .memories-btn-danger {
  background: #e0a0a0;
  color: #330000;
  border: 1px solid #cc4400;
}
[data-dsap="memories-dyna"] .memories-btn-small { padding: 3px 8px; font-size: 9pt; }
[data-dsap="memories-dyna"] .memories-btn-tiny { padding: 2px 6px; font-size: 8pt; }

/* Stats bar retro styles in override below (old dark flex/pill rules removed) */

/* List */
[data-dsap="memories-dyna"] .memories-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
[data-dsap="memories-dyna"] .memories-memory-item {
    background: linear-gradient(180deg, #16233a, #101a2b);
    border: 1px solid #2f4868;
    border-radius: 6px;
    padding: 9px 11px;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 1px 3px rgba(0,0,0,0.4);
    transition: border-color .1s, box-shadow .1s, transform .05s;
}
[data-dsap="memories-dyna"] .memories-memory-item:hover {
    border-color: #4f7ab8;
    box-shadow: 0 0 0 1px rgba(79,122,184,0.25), 0 2px 6px rgba(0,0,0,0.35);
    transform: translateY(-1px);
}
[data-dsap="memories-dyna"] .memories-memory-item-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
}
[data-dsap="memories-dyna"] .memories-memory-name {
    font-weight: 700;
    color: #b8d4ff;
    font-size: 11pt;
    line-height: 1.2;
}
[data-dsap="memories-dyna"] .memories-memory-badges {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}
[data-dsap="memories-dyna"] .memories-badge {
    font-size: 11pt;
    padding: 1px 7px;
    border-radius: 999px;
    background: #253c57;
    color: #a3b9d9;
    border: 1px solid #3a5577;
    font-weight: 600;
    letter-spacing: .3px;
}
[data-dsap="memories-dyna"] .memories-badge.category {
    background: linear-gradient(180deg, #e07a2a, #c25f18);
    color: #fff;
    border-color: #f08f3f;
    text-shadow: 0 1px 1px rgba(0,0,0,0.3);
}
[data-dsap="memories-dyna"] .memories-memory-desc {
    color: #9fb3d1;
    font-size: 11pt;
    line-height: 1.35;
    margin-bottom: 5px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
[data-dsap="memories-dyna"] .memories-memory-meta {
    display: flex;
    gap: 10px;
    font-size: 11pt;
    color: #6e8ab3;
}
[data-dsap="memories-dyna"] .memories-memory-meta span { display: inline-flex; align-items: center; gap: 3px; }

/* Details view - fully handled by retro overrides below (old modern styles removed for Linksys consistency) */

/* Old dark pager rules removed - retro version in overrides below */

/* Bulk delete - retro Linksys style */
[data-dsap="memories-dyna"] .memories-delete-toolbar {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  margin-bottom: 6px !important;
  padding: 3px !important;
  background: #f0f0f0 !important;
  border: 1px solid #999 !important;
}
[data-dsap="memories-dyna"] .memories-delete-title {
  flex: 1 !important;
  font-size: 12pt !important;
  font-weight: bold !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-delete-warning {
  display: flex !important;
  gap: 6px !important;
  align-items: flex-start !important;
  background: #ffffee !important;
  border: 1px solid #cc4400 !important;
  color: #330000 !important;
  padding: 6px 8px !important;
  font-size: 11pt !important;
  margin-bottom: 8px !important;
}
[data-dsap="memories-dyna"] .memories-delete-warning i {
  color: #cc4400 !important;
  margin-top: 1px !important;
}
[data-dsap="memories-dyna"] .memories-delete-options {
  display: flex !important;
  flex-direction: column !important;
  gap: 3px !important;
  margin-bottom: 6px !important;
}
[data-dsap="memories-dyna"] .memories-delete-option {
  background: #fff !important;
  border: 1px solid #999 !important;
  padding: 4px 6px !important;
  cursor: pointer !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-delete-option:hover {
  background: #f8f8f8 !important;
}
[data-dsap="memories-dyna"] .memories-delete-option.selected {
  border-color: #cc4400 !important;
  background: #ffffee !important;
}
[data-dsap="memories-dyna"] .memories-delete-opt-title {
  font-weight: bold !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-delete-opt-desc {
  font-size: 11pt !important;
  color: #333 !important;
}
[data-dsap="memories-dyna"] .memories-delete-count-panel {
  background: #f8f8f8 !important;
  border: 1px solid #999 !important;
  padding: 4px 6px !important;
  margin-bottom: 6px !important;
  text-align: center !important;
}
[data-dsap="memories-dyna"] .memories-delete-count-label {
  font-size: 11pt !important;
  text-transform: uppercase !important;
  color: #333 !important;
}
[data-dsap="memories-dyna"] .memories-delete-count-value {
  font-size: 14pt !important;
  font-weight: bold !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-delete-count-desc {
  font-size: 11pt !important;
  color: #555 !important;
}
[data-dsap="memories-dyna"] .memories-delete-actions {
  display: flex !important;
  gap: 6px !important;
}

/* Static Rules - retro Linksys toolbar and content */
[data-dsap="memories-dyna"] .memories-static-rules-toolbar {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  padding: 4px 6px !important;
  background: #f0f0f0 !important;
  border: 1px solid #999 !important;
  margin-bottom: 4px !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-title {
  font-weight: bold !important;
  font-size: 11pt !important;
  color: #000 !important;
  flex: 1 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher {
  margin-left: auto !important;
  display: flex !important;
  gap: 0 !important; /* attached as one button */
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher .memories-btn {
  font-size: 11pt !important;
  padding: 2px 8px !important;
  border: 1px solid #666 !important;
  background: #c0c0c0 !important;
  color: #000 !important;
  border-radius: 0 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher .memories-btn:first-child {
  border-right: none !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher .memories-btn[style*="003366"] {
  background: #003366 !important;
  color: #fff !important;
  border-color: #000033 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-list-container {
  background: #fff !important;
  border: 1px solid #666 !important;
  padding: 4px !important;
  margin-bottom: 4px !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-list {
  display: block !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-item,
[data-dsap="memories-dyna"] .memories-static-feedback-item {
  background: #f8f8f8 !important;
  border: 1px solid #999 !important;
  padding: 4px 6px !important;
  margin-bottom: 2px !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-content {
  display: flex !important;
  gap: 6px !important;
  align-items: flex-start !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-text {
  flex: 1 !important;
  font-size: 11pt !important;
  line-height: 1.35 !important;
  padding: 2px 4px !important;
  background: #fff !important;
  border: 1px solid #666 !important;
  color: #000 !important;
  cursor: text !important;
  min-height: 28px !important;
  white-space: pre-wrap !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-text:focus {
  outline: 1px solid #003366 !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-actions {
  display: flex !important;
  gap: 2px !important;
  flex-shrink: 0 !important;
}
[data-dsap="memories-dyna"] .memories-static-feedback-details {
  font-size: 11pt !important;
  color: #333 !important;
  margin-top: 2px !important;
  line-height: 1.3 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-hint {
  font-size: 11pt !important;
  color: #555 !important;
  margin-top: 2px !important;
  font-style: italic !important;
}

/* Hidden helper */
[data-dsap="memories-dyna"] .hidden { display: none !important; }

/* =====================================================
   RETRO OVERRIDES (web 1.5 Linksys style - match Quips DSAP)
   Forces consistent 2000s admin panel look on all elements.
   ===================================================== */
[data-dsap="memories-dyna"].memories-dsap {
  background: #eeeeee !important;
  color: #000000 !important;
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-hero,
[data-dsap="memories-dyna"] .memories-hero-icon,
[data-dsap="memories-dyna"] .memories-hero-text,
[data-dsap="memories-dyna"] .memories-hero-title,
[data-dsap="memories-dyna"] .memories-hero-subtitle {
  display: none !important;
}
[data-dsap="memories-dyna"] .memories-toolbar,
[data-dsap="memories-dyna"] .memories-details-toolbar,
[data-dsap="memories-dyna"] .memories-static-rules-toolbar,
[data-dsap="memories-dyna"] .memories-delete-toolbar {
  background: #f0f0f0 !important;
  border: 1px solid #999 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
[data-dsap="memories-dyna"] .memories-btn,
[data-dsap="memories-dyna"] .memories-filter-btn {
  background: #c0c0c0 !important;
  color: #000 !important;
  border: 1px solid #ff8c00 !important;
  border-radius: 3px !important;
  box-shadow: 1px 1px 0 #fff inset, -1px -1px 0 #808080 inset !important;
  font-size: 11pt !important;
  padding: 3px 8px !important;
}
[data-dsap="memories-dyna"] .memories-btn:active {
  box-shadow: -1px -1px 0 #fff inset, 1px 1px 0 #808080 inset !important;
  background: #b0b0b0 !important;
}
[data-dsap="memories-dyna"] .memories-btn-primary {
  background: #d4d8e0 !important;
  border: 2px solid #ff8c00 !important;
}
[data-dsap="memories-dyna"] .memories-btn-danger {
  background: #e0a0a0 !important;
  color: #330000 !important;
  border-color: #cc4400 !important;
}
[data-dsap="memories-dyna"] .memories-search-input,
[data-dsap="memories-dyna"] .memories-input,
[data-dsap="memories-dyna"] .memories-textarea,
[data-dsap="memories-dyna"] .memories-perpage-btn {
  background: #fff !important;
  border: 1px solid #666 !important;
  border-radius: 0 !important;
  color: #000 !important;
  font-size: 11pt !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
[data-dsap="memories-dyna"] .memories-stats-bar,
[data-dsap="memories-dyna"] .memories-list,
[data-dsap="memories-dyna"] .memories-memory-item,
[data-dsap="memories-dyna"] .memories-details-body,
[data-dsap="memories-dyna"] .memories-static-rules-list-container,
[data-dsap="memories-dyna"] .memories-static-rule-item,
[data-dsap="memories-dyna"] .memories-static-feedback-item,
[data-dsap="memories-dyna"] .memories-entity-card,
[data-dsap="memories-dyna"] .memories-relation-card,
[data-dsap="memories-dyna"] .memories-obs-card,
[data-dsap="memories-dyna"] .memories-delete-warning,
[data-dsap="memories-dyna"] .memories-delete-option,
[data-dsap="memories-dyna"] .memories-delete-count-panel {
  background: #fff !important;
  border: 1px solid #999 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-stat-pill {
  background: #f4f4f4 !important;
  border: 1px solid #666 !important;
  border-radius: 0 !important;
  color: #000 !important;
  font-weight: bold;
}
[data-dsap="memories-dyna"] .memories-badge.category {
  background: #003366 !important;
  color: #fff !important;
  border-color: #000033 !important;
}
[data-dsap="memories-dyna"] .memories-memory-name,
[data-dsap="memories-dyna"] .memories-details-title,
[data-dsap="memories-dyna"] .memories-static-rules-title {
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-static-rule-text,
[data-dsap="memories-dyna"] .memories-textarea {
  background: #fff !important;
  border: 1px solid #666 !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-dropdown-menu {
  background: #fff !important;
  border: 1px solid #666 !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  padding: 2px 0 !important;
  margin-top: 2px !important;
  position: absolute !important;
  z-index: 50 !important;
  min-width: 160px !important;
}
[data-dsap="memories-dyna"] .memories-dropdown-menu .memories-dd-item {
  padding: 4px 10px !important;
  font-size: 11pt !important;
  cursor: pointer !important;
  color: #000 !important;
  background: transparent !important;
}
[data-dsap="memories-dyna"] .memories-dropdown-menu .memories-dd-item:hover {
  background: #003366 !important;
  color: #fff !important;
}
[data-dsap="memories-dyna"] .memories-dropdown-menu .memories-dd-item.selected {
  background: #003366 !important;
  color: #fff !important;
}
[data-dsap="memories-dyna"] .memories-hint {
  color: #222 !important;
  font-style: italic;
}
[data-dsap="memories-dyna"] .memories-memory-desc,
[data-dsap="memories-dyna"] .memories-memory-meta,
[data-dsap="memories-dyna"] .memories-field-label,
[data-dsap="memories-dyna"] .memories-field-desc,
[data-dsap="memories-dyna"] .memories-static-feedback-details,
[data-dsap="memories-dyna"] .memories-static-rules-hint,
[data-dsap="memories-dyna"] .memories-delete-opt-desc,
[data-dsap="memories-dyna"] .memories-delete-count-desc,
[data-dsap="memories-dyna"] .memories-delete-count-label {
  color: #111111 !important;
}
[data-dsap="memories-dyna"] .memories-badge {
  background: #333333 !important;
  color: #ffffff !important;
  border-color: #666 !important;
}
[data-dsap="memories-dyna"] .memories-stat-pill {
  border-color: #555 !important;
}
/* Stats table cells for Linksys segmentation (only shown on main list) */
[data-dsap="memories-dyna"] .memories-stats-bar td {
  font-size: 11pt !important;
  padding: 3px 6px !important;
  text-align: center !important;
  border: 1px solid #999 !important;
  background: #f4f4f4 !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-section-head h4,
[data-dsap="memories-dyna"] .memories-details-body h4 {
  background: #003366 !important;
  color: #ffffff !important;
  padding: 2px 5px !important;
  margin: 3px 0 2px !important;
  font-size: 11pt !important;
  font-weight: bold !important;
  border: 1px solid #000033 !important;
}
[data-dsap="memories-dyna"] .memories-memory-item,
[data-dsap="memories-dyna"] .memories-entity-card,
[data-dsap="memories-dyna"] .memories-relation-card,
[data-dsap="memories-dyna"] .memories-obs-card {
  border-color: #666 !important;
  background: #f8f8f8 !important;
}

/* Input fields & editing (Linksys retro form style with bevel) */
[data-dsap="memories-dyna"] .memories-input,
[data-dsap="memories-dyna"] .memories-textarea {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
  color: #000000 !important;
  font-size: 11pt !important;
  padding: 2px 4px !important;
  box-shadow: 1px 1px 0 #ffffff inset, -1px -1px 0 #cccccc inset !important;
  border-radius: 0 !important;
}
[data-dsap="memories-dyna"] .memories-textarea {
  min-height: 400px !important;
  font-family: monospace !important;
}
[data-dsap="memories-dyna"] .memories-remove-btn {
  background: #d4d0c8 !important;
  border: 1px solid #ff8c00 !important;
  color: #330000 !important;
  padding: 1px 4px !important;
  font-size: 11pt !important;
  border-radius: 2px !important;
  box-shadow: 1px 1px 0 #ffffff inset, -1px -1px 0 #808080 inset !important;
  cursor: pointer !important;
}
[data-dsap="memories-dyna"] .memories-remove-btn:active {
  box-shadow: -1px -1px 0 #ffffff inset, 1px 1px 0 #808080 inset !important;
}

/* Static rules switcher bevel/segmented - attached to right of bar */
[data-dsap="memories-dyna"] .memories-static-rules-switcher {
  margin-left: auto !important;
  display: flex !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher .memories-btn {
  font-size: 11pt !important;
  padding: 3px 8px !important;
  border: 1px solid #666 !important;
  background: #c0c0c0 !important;
  color: #000 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-switcher .memories-btn[style*="003366"] {
  background: #003366 !important;
  color: #fff !important;
  border-color: #000033 !important;
}

/* More base + custom for visibility and Linksys segmentation */
[data-dsap="memories-dyna"] .memories-dsap {
  background: #eeeeee !important;
  color: #000000 !important;
}
[data-dsap="memories-dyna"] .memories-toolbar,
[data-dsap="memories-dyna"] .memories-static-rules-toolbar,
[data-dsap="memories-dyna"] .memories-details-toolbar {
  background: #f0f0f0 !important;
  border: 1px solid #999999 !important;
}
[data-dsap="memories-dyna"] .memories-static-rules-list-container,
[data-dsap="memories-dyna"] .memories-details-body {
  background: #ffffff !important;
  border: 1px solid #666666 !important;
}

/* Full retro Linksys updates for /view/ (details) page - cover all used classes/elements */
[data-dsap="memories-dyna"] .memories-details-toolbar {
  background: #f0f0f0 !important;
  border: 1px solid #999 !important;
  padding: 4px 6px !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  margin-bottom: 4px !important;
}
[data-dsap="memories-dyna"] .memories-details-title {
  flex: 1 !important;
  font-weight: bold !important;
  font-size: 11pt !important;
  color: #000000 !important;
  padding-left: 2px !important;
}
[data-dsap="memories-dyna"] .memories-details-actions {
  display: flex !important;
  gap: 3px !important;
}
[data-dsap="memories-dyna"] .memories-details-body {
  background: #fff !important;
  border: 1px solid #666 !important;
  padding: 6px !important;
  display: block !important;
  gap: 4px !important;
}
[data-dsap="memories-dyna"] .memories-field {
  margin-bottom: 4px !important;
  border-bottom: 1px dotted #999 !important;
  padding-bottom: 3px !important;
}
[data-dsap="memories-dyna"] .memories-field-row {
  display: flex !important;
  gap: 8px !important;
}
[data-dsap="memories-dyna"] .memories-field-row > .memories-field {
  flex: 1 !important;
  min-width: 0 !important;
  border-bottom: none !important;
  padding-bottom: 0 !important;
}
[data-dsap="memories-dyna"] .memories-field-label {
  font-size: 11pt !important;
  font-weight: bold !important;
  color: #333333 !important;
  margin-bottom: 1px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.5px !important;
}
[data-dsap="memories-dyna"] .memories-field-value {
  color: #000000 !important;
  font-size: 11pt !important;
  background: #f8f8f8 !important;
  border: 1px solid #999 !important;
  padding: 2px 4px !important;
  min-height: 18px !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
}
[data-dsap="memories-dyna"] .memories-field-desc {
  line-height: 1.3 !important;
}
[data-dsap="memories-dyna"] .memories-section {
  margin-top: 6px !important;
}
[data-dsap="memories-dyna"] .memories-section-head {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  margin-bottom: 2px !important;
}
[data-dsap="memories-dyna"] .memories-entities,
[data-dsap="memories-dyna"] .memories-relations,
[data-dsap="memories-dyna"] .memories-observations {
  display: block !important;
  gap: 2px !important;
}

/* Entity/Relation/Obs cards - segmented bordered panels */
[data-dsap="memories-dyna"] .memories-entity-card,
[data-dsap="memories-dyna"] .memories-relation-card,
[data-dsap="memories-dyna"] .memories-obs-card {
  background: #fff !important;
  border: 1px solid #999 !important;
  padding: 3px 5px !important;
  margin-bottom: 2px !important;
}
[data-dsap="memories-dyna"] .memories-entity-head {
  display: flex !important;
  gap: 4px !important;
  align-items: center !important;
  margin-bottom: 1px !important;
}
[data-dsap="memories-dyna"] .memories-entity-name {
  font-weight: bold !important;
  color: #000000 !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-entity-type {
  font-size: 11pt !important;
  padding: 0 3px !important;
  background: #f0f0f0 !important;
  color: #333 !important;
  border: 1px solid #999 !important;
}
[data-dsap="memories-dyna"] .memories-entity-attrs {
  font-family: monospace !important;
  font-size: 11pt !important;
  color: #222 !important;
  background: #f8f8f8 !important;
  padding: 2px 3px !important;
  border: 1px solid #ccc !important;
  margin-top: 1px !important;
  white-space: pre-wrap !important;
}
[data-dsap="memories-dyna"] .memories-rel-arrow {
  color: #555 !important;
  margin: 0 2px !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-rel-from,
[data-dsap="memories-dyna"] .memories-rel-to {
  font-weight: 600 !important;
  color: #000000 !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-rel-type {
  font-style: italic !important;
  color: #333 !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-obs-content {
  color: #111 !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-obs-imp {
  font-size: 11pt !important;
  color: #333 !important;
  margin-top: 1px !important;
}

/* Edit mode */
[data-dsap="memories-dyna"] .memories-edit-row {
  display: flex !important;
  gap: 4px !important;
  align-items: flex-end !important;
  margin-top: 2px !important;
}
[data-dsap="memories-dyna"] .memories-edit-row > .memories-input {
  flex: 1 !important;
}
[data-dsap="memories-dyna"] .memories-remove-btn {
  background: #d4d0c8 !important;
  border: 1px solid #ff8c00 !important;
  color: #330000 !important;
  padding: 1px 3px !important;
  font-size: 11pt !important;
  border-radius: 2px !important;
  box-shadow: 1px 1px 0 #fff inset, -1px -1px 0 #808080 inset !important;
  cursor: pointer !important;
  line-height: 1 !important;
}
[data-dsap="memories-dyna"] .memories-remove-btn:active {
  box-shadow: -1px -1px 0 #fff inset, 1px 1px 0 #808080 inset !important;
  background: #b0b0b0 !important;
}

/* Inputs in details edit */
[data-dsap="memories-dyna"] .memories-input {
  background: #fff !important;
  border: 1px solid #666 !important;
  color: #000 !important;
  font-size: 11pt !important;
  padding: 1px 3px !important;
  box-shadow: 1px 1px 0 #fff inset, -1px -1px 0 #ccc inset !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
[data-dsap="memories-dyna"] .memories-textarea {
  min-height: 400px !important;
  font-family: monospace !important;
  width: 100% !important;
  display: block !important;
}
[data-dsap="memories-dyna"] #memoriesDetailDescEdit.hidden,
[data-dsap="memories-dyna"] .memories-textarea.hidden {
  display: none !important;
}

/* Retro Linksys-style pager + footer (simple bordered bar, small text, segmented controls) */
[data-dsap="memories-dyna"] .memories-pager {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 4px !important;
  margin-top: 4px !important;
  padding: 3px 4px !important;
  background: #f0f0f0 !important;
  border: 1px solid #999 !important;
  font-size: 11pt !important;
  box-sizing: border-box !important;
}
[data-dsap="memories-dyna"] .memories-pager-info {
  color: #333 !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
}
[data-dsap="memories-dyna"] .memories-pager-info strong {
  color: #000 !important;
  font-weight: bold !important;
}
[data-dsap="memories-dyna"] .memories-pager-range {
  color: #555 !important;
  font-size: 11pt !important;
  opacity: 0.8 !important;
}
[data-dsap="memories-dyna"] .memories-perpage {
  display: flex !important;
  align-items: center !important;
  gap: 3px !important;
  margin-left: auto !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-perpage label {
  color: #444 !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-perpage-dropdown {
  min-width: 4.5em;
}
[data-dsap="memories-dyna"] .memories-perpage-btn {
  background: #fff !important;
  border: 1px solid #666 !important;
  color: #000 !important;
  font-size: 11pt !important;
  padding: 1px 3px !important;
  border-radius: 0 !important;
}

/* Footer (bulk actions + hint) */
[data-dsap="memories-dyna"] .memories-footer {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  margin-top: 4px !important;
  padding-top: 3px !important;
  border-top: 1px solid #999 !important;
  font-size: 11pt !important;
  color: #333 !important;
}
[data-dsap="memories-dyna"] .memories-hint {
  color: #555 !important;
  font-style: italic !important;
  font-size: 11pt !important;
}
[data-dsap="memories-dyna"] .memories-bulk {
  /* container for the delete dropdown - keep simple */
}

/* Do not override font-family on <i> so FontAwesome icons render correctly */
[data-dsap="memories-dyna"] i,
[data-dsap="memories-dyna"] i * {
  font-family: "Font Awesome 5 Free", "Font Awesome 5 Pro", "FontAwesome", sans-serif !important;
  font-weight: 900 !important;
}
`;

const memoriesDsapDriver = {
    _state: null,

    init(host) {
        // Fresh state per activation (the shell re-inits us when the URL changes via navigate)
        this._state = {
            host,
            memories: [],           // current page items
            listMeta: { total: 0, page: 1, perPage: MEMORIES_DEFAULT_PER_PAGE, search: '', category: null },
            current: null,          // detail memory
            isEdit: false,
            original: null,
            wsHandlers: []
        };

        const root = host.getRoot();
        if (!root) return;

        // Ensure the list footer bulk button is visible unless we're on the delete page
        const bulkWrap = root.querySelector('.memories-bulk');
        if (bulkWrap) bulkWrap.style.display = '';

        // Determine view mode from the *current* DSAP URL (this enables back/forward + direct links)
        const segments = (typeof host.getPathSegments === 'function' ? host.getPathSegments() : []).map(memoriesDsapDecodeSegment);
        const isDetailView = segments[0] === 'view' && !!segments[1];
        const isDeleteView = segments[0] === 'delete' || segments[0] === 'bulk-delete';
        const isStaticRulesView = segments[0] === 'static_rules';

        // Wire common controls (they only make sense in their respective views)
        this._wireCommonControls(root);

        // Category dropdown (list only)
        this._wireCategoryDropdown(root);

        // Bulk "Delete Memories" button in list footer now opens the dedicated delete selector page
        this._wireBulkDeleteButton(root, host);

        const statsBar = root.querySelector('#memoriesStatsBar');
        if (statsBar) statsBar.style.display = 'none';

        const rulesBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesBtn) rulesBtn.style.display = 'none';

        if (isDeleteView) {
            if (bulkWrap) bulkWrap.style.display = 'none';
            this._showDeleteView();
        } else if (isDetailView) {
            if (bulkWrap) bulkWrap.style.display = 'none';
            const name = memoriesDsapDecodeSegment(segments[1]);
            // Load the specific memory for the detail view
            void this._loadDetailByName(name);
        } else if (isStaticRulesView) {
            if (bulkWrap) bulkWrap.style.display = 'none';
            const sub = segments[1];
            const view = (sub === 'feedback') ? 'feedback' : 'rules';
            this._showStaticRulesView(view);
        } else {
            // Parse list state from query params (page, perPage, search, category)
            const page = Math.max(1, parseInt(host.getQueryParam('page') || '1', 10) || 1);
            const perPage = Math.max(5, Math.min(200, parseInt(host.getQueryParam('perPage') || String(MEMORIES_DEFAULT_PER_PAGE), 10) || MEMORIES_DEFAULT_PER_PAGE));
            const search = host.getQueryParam('search') || '';
            const category = host.getQueryParam('category') || null;

            this._state.listMeta = { total: 0, page, perPage, search, category };

            // Prefill UI from URL state immediately (before data arrives)
            this._prefillListControlsFromMeta(root);

            if (statsBar) statsBar.style.display = '';
            if (rulesBtn) rulesBtn.style.display = '';

            // Load the page from server (server does search + category filter + paging)
            void this._loadPagedList({ page, perPage, search, category });
        }

        // Listen for external changes if any
        this._bindWs(root, host);
    },

    /** Wire buttons that exist in both (or either) views */
    _wireCommonControls(root) {
        const editBtn = root.querySelector('#memoriesEditBtn');
        if (editBtn) editBtn.addEventListener('click', () => this._enterEdit());

        const saveBtn = root.querySelector('#memoriesSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => this._save());

        const cancelBtn = root.querySelector('#memoriesCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._exitEdit(true));

        const delBtn = root.querySelector('#memoriesDeleteBtn');
        if (delBtn) delBtn.addEventListener('click', () => this._deleteCurrent());

        const addEnt = root.querySelector('#memoriesAddEntityBtn');
        if (addEnt) addEnt.addEventListener('click', () => this._addEntity());

        const addRel = root.querySelector('#memoriesAddRelationBtn');
        if (addRel) addRel.addEventListener('click', () => this._addRelation());

        const addObs = root.querySelector('#memoriesAddObsBtn');
        if (addObs) addObs.addEventListener('click', () => this._addObservation());

        // Pager buttons + per-page selector (only present in list view)
        const pager = root.querySelector('#memoriesPager');
        if (pager) {
            pager.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-pager]');
                if (!btn) return;
                const action = btn.dataset.pager;
                const meta = this._state.listMeta || {};
                let newPage = meta.page || 1;
                if (action === 'prev') newPage = Math.max(1, newPage - 1);
                if (action === 'next') newPage = newPage + 1;
                this._navigateToListPage(newPage);
            });

            this._wirePerPageDropdown(root);
        }

        // Live search → URL navigation (debounced so we don't spam history on every keystroke)
        const searchInput = root.querySelector('#memoriesSearchInput');
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    const meta = this._state.listMeta || {};
                    const newSearch = searchInput.value || '';
                    // Only navigate if the value actually changed from what the URL says
                    if ((meta.search || '') !== newSearch) {
                        const url = memoriesDsapBuildListUrl({
                            page: 1, // new search resets to first page
                            perPage: meta.perPage || MEMORIES_DEFAULT_PER_PAGE,
                            search: newSearch,
                            category: meta.category || ''
                        });
                        if (typeof this._state.host.navigate === 'function') {
                            this._state.host.navigate(url);
                        } else {
                            void this._loadPagedList({ page: 1, perPage: meta.perPage, search: newSearch, category: meta.category });
                        }
                    }
                }, 280);
            });

            // Also allow pressing Enter to force immediate navigation
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchTimer);
                    const meta = this._state.listMeta || {};
                    const url = memoriesDsapBuildListUrl({
                        page: 1,
                        perPage: meta.perPage || MEMORIES_DEFAULT_PER_PAGE,
                        search: searchInput.value || '',
                        category: meta.category || ''
                    });
                    if (typeof this._state.host.navigate === 'function') {
                        this._state.host.navigate(url);
                    }
                }
            });
        }

        // Button on the main page (in stats bar) to access static rules
        const rulesAccessBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesAccessBtn) {
            rulesAccessBtn.addEventListener('click', () => {
                if (typeof this._state.host.navigate === 'function') {
                    this._state.host.navigate(`dsap://${MEMORIES_DSAP_URL}/static_rules`);
                }
            });
        }
    },

    refresh(host) {
        this.destroy(host);
        this.init(host);
    },

    destroy(host) {
        const state = this._state;
        if (!state) return;
        state.wsHandlers.forEach((fn) => {
            try { if (window.wsClient && typeof window.wsClient.off === 'function') window.wsClient.off('list_knowledge_memories_response', fn); } catch (_) {}
        });
        state.wsHandlers = [];
        this._state = null;
    },

    _bindWs(root, host) {
        if (!window.wsClient) return;
        // No live push updates for the memories list today; user uses browser nav / reload.
    },

    /** Prefill search input + category label + per-page select from the meta we parsed from the URL */
    _prefillListControlsFromMeta(root) {
        const meta = this._state.listMeta || {};
        const searchInput = root.querySelector('#memoriesSearchInput');
        if (searchInput) searchInput.value = meta.search || '';

        const label = root.querySelector('#memoriesCategoryLabel');
        if (label) label.textContent = meta.category || 'All Categories';

        const hidden = root.querySelector('#memoriesPerPageHidden');
        const selected = root.querySelector('#memoriesPerPageSelected');
        const perVal = String(meta.perPage || MEMORIES_DEFAULT_PER_PAGE);
        if (hidden) hidden.value = perVal;
        if (selected) selected.textContent = perVal;
    },

    _wirePerPageDropdown(root) {
        const container = root.querySelector('#memoriesPerPageDropdown');
        const btn = root.querySelector('#memoriesPerPageBtn');
        const menu = root.querySelector('#memoriesPerPageMenu');
        const selectedEl = root.querySelector('#memoriesPerPageSelected');
        const hidden = root.querySelector('#memoriesPerPageHidden');
        if (!container || !btn || !menu || !selectedEl || !hidden) return;
        if (container.dataset.wired === '1') return;
        container.dataset.wired = '1';

        const items = MEMORIES_PER_PAGE_OPTIONS.map((n) => ({ value: String(n), name: String(n) }));

        const renderMenu = (selectedVal) => {
            // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
            renderSimpleDropdown(
                menu,
                items,
                'value',
                'name',
                (value) => {
                    const newPer = parseInt(value, 10) || MEMORIES_DEFAULT_PER_PAGE;
                    hidden.value = String(newPer);
                    selectedEl.textContent = String(newPer);
                    this._navigateToListPage(1, newPer);
                },
                () => closeDropdown(menu, btn), // closeDropdown: public/scripts/comp/dropdown.js
                String(selectedVal || hidden.value),
                { preventFocusTransfer: true }
            );
        };

        // setupDropdown: public/scripts/comp/dropdown.js
        setupDropdown(container, btn, menu, renderMenu, () => hidden.value, { preventFocusTransfer: true });
    },

    /** Load a page of memories (server does the search + category + ordering + paging) */
    async _loadPagedList({ page = 1, perPage = MEMORIES_DEFAULT_PER_PAGE, search = '', category = null } = {}) {
        const root = this._state.host.getRoot();
        const list = root.querySelector('#memoriesList');
        const loading = root.querySelector('#memoriesLoading');
        const empty = root.querySelector('#memoriesEmpty');
        const pager = root.querySelector('#memoriesPager');

        if (loading) loading.classList.remove('hidden');
        if (list) list.classList.add('hidden');
        if (empty) empty.classList.add('hidden');
        if (pager) pager.style.opacity = '0.5';

        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }

            const resp = await window.wsClient.sendMessage('list_knowledge_memories', {
                page,
                perPage,
                search,
                category
            });

            if (resp && resp.success) {
                this._state.memories = resp.memories || [];
                this._state.listMeta = {
                    total: resp.total || 0,
                    page: resp.page || page,
                    perPage: resp.perPage || perPage,
                    search: search || '',
                    category: category || null
                };

                this._updateStats(resp.stats);
                this._renderPagedList();
                // Keep the toolbar controls in sync with the loaded meta (search value, category label, per-page)
                this._prefillListControlsFromMeta(root);
                if (pager) pager.style.opacity = '';
            } else {
                this._showEmpty('Failed to load memories');
            }
        } catch (e) {
            console.error('memories DSAP paged load error', e);
            this._showEmpty('Error loading memories');
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, 'Failed to load memories');
            }
        }
    },

    async _loadDetailByName(name) {
        const root = this._state.host.getRoot();
        const listView = root.querySelector('#memoriesListView');
        const detailsView = root.querySelector('#memoriesDetailsView');
        const titleEl = root.querySelector('#memoriesDetailsTitle');

        if (titleEl) titleEl.textContent = 'Loading...';
        if (listView) listView.classList.add('hidden');
        if (detailsView) detailsView.classList.remove('hidden');

        try {
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }
            const resp = await window.wsClient.sendMessage('get_knowledge_memory', { name });
            if (resp && resp.success && resp.memory) {
                this._state.current = resp.memory;
                this._state.isEdit = false;
                this._renderDetails();
                // Make sure we are in the details view
                if (listView) listView.classList.add('hidden');
                if (detailsView) detailsView.classList.remove('hidden');
            } else {
                // Memory not found or error
                if (detailsView) {
                    detailsView.innerHTML = `
                        <div class="memories-details-toolbar">
                            <div class="memories-details-title">Memory not found</div>
                        </div>
                        <div class="memories-details-body" style="padding:8px;">
                            <div style="border:1px solid #999; background:#fff; padding:6px; font-size:11pt;">
                                The memory "${memoriesDsapEscapeHtml(name)}" could not be loaded.
                            </div>
                        </div>
                    `;
                }
                if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Memory not found');
            }
        } catch (e) {
            console.error('memories DSAP detail load error', e);
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Error loading memory');
        }
    },

    _updateStats(stats) {
        const root = this._state.host.getRoot();
        if (!root || !stats) return;
        // Keep the full stats object so the category dropdown can use stats.categories even in paged mode
        this._state.lastStats = stats;

        const set = (id, val) => {
            const el = root.querySelector('#' + id);
            if (el) el.textContent = (val != null ? val : '0');
        };
        set('memoriesStatTotal', stats.totalMemories);
        set('memoriesStatEntities', stats.totalEntities);
        set('memoriesStatRelations', stats.totalRelations);
    },

    /** Render the current page of results + the pager */
    _renderPagedList() {
        const root = this._state.host.getRoot();
        const listEl = root.querySelector('#memoriesList');
        const loading = root.querySelector('#memoriesLoading');
        const empty = root.querySelector('#memoriesEmpty');
        const pagerEl = root.querySelector('#memoriesPager');

        if (loading) loading.classList.add('hidden');

        const meta = this._state.listMeta || { total: 0, page: 1, perPage: MEMORIES_DEFAULT_PER_PAGE };
        const items = this._state.memories || [];

        // Update pager UI
        this._renderPager(root, meta);

        if (!items.length) {
            if (listEl) listEl.classList.add('hidden');
            if (empty) {
                empty.classList.remove('hidden');
                const msg = (meta.search || meta.category)
                    ? 'No memories match your search or filter'
                    : 'No memories found';
                empty.innerHTML = `<span>${memoriesDsapEscapeHtml(msg)}</span>`;
            }
            if (pagerEl) pagerEl.style.display = (meta.total > 0 ? '' : 'none');
            return;
        }

        if (empty) empty.classList.add('hidden');
        if (listEl) {
            listEl.classList.remove('hidden');
            listEl.innerHTML = '';
        }

        items.forEach(mem => {
            const item = document.createElement('div');
            item.className = 'memories-memory-item';

            const last = mem.last_used_at ? memoriesDsapFormatDate(mem.last_used_at) : 'Never';
            const catBadge = mem.category ? `<span class="memories-badge category">${memoriesDsapEscapeHtml(mem.category)}</span>` : '';
            const uses = `<span class="memories-badge">${mem.usage_count || 0} uses</span>`;

            item.innerHTML = `
                <div class="memories-memory-item-header">
                    <div class="memories-memory-name">${memoriesDsapEscapeHtml(mem.name)}</div>
                    <div class="memories-memory-badges">${catBadge}${uses}</div>
                </div>
                <div class="memories-memory-desc">${memoriesDsapEscapeHtml(mem.description || '')}</div>
                <div class="memories-memory-meta">
                    <span><i class="fas fa-star"></i> ${((mem.confidence || 0) * 100).toFixed(0)}%</span>
                    <span><i class="fas fa-clock"></i> ${last}</span>
                </div>
            `;

            // IMPORTANT: use host.navigate so the URL updates and browser history works
            item.addEventListener('click', () => {
                const listCtx = {
                    page: meta.page,
                    perPage: meta.perPage,
                    search: meta.search || '',
                    category: meta.category || ''
                };
                const url = memoriesDsapBuildDetailUrl(mem.name, listCtx);
                if (typeof this._state.host.navigate === 'function') {
                    this._state.host.navigate(url);
                } else {
                    // Fallback (shouldn't happen)
                    this._state.current = mem;
                    this._renderDetails();
                    this._showDetails();
                }
            });

            if (listEl) listEl.appendChild(item);
        });

        if (pagerEl) pagerEl.style.display = '';
    },

    _renderPager(root, meta) {
        if (!root || !meta) return;

        const total = meta.total || 0;
        const page = meta.page || 1;
        const per = meta.perPage || MEMORIES_DEFAULT_PER_PAGE;
        const totalPages = Math.max(1, Math.ceil(total / per));

        const pageEl = root.querySelector('#memoriesPagerPage');
        const totalPagesEl = root.querySelector('#memoriesPagerTotalPages');
        const rangeEl = root.querySelector('#memoriesPagerRange');
        const totalEl = root.querySelector('#memoriesPagerTotal');
        const hidden = root.querySelector('#memoriesPerPageHidden');
        const selected = root.querySelector('#memoriesPerPageSelected');
        const perVal = String(per);
        if (hidden) hidden.value = perVal;
        if (selected) selected.textContent = perVal;

        if (pageEl) pageEl.textContent = String(page);
        if (totalPagesEl) totalPagesEl.textContent = String(totalPages);
        if (totalEl) totalEl.textContent = String(total);

        const start = total === 0 ? 0 : ((page - 1) * per) + 1;
        const end = Math.min(page * per, total);
        if (rangeEl) rangeEl.textContent = `${start}-${end}`;

        // Enable/disable prev/next
        const prevBtn = root.querySelector('[data-pager="prev"]');
        const nextBtn = root.querySelector('[data-pager="next"]');
        if (prevBtn) prevBtn.disabled = (page <= 1);
        if (nextBtn) nextBtn.disabled = (page >= totalPages);
    },

    /** Navigate to a (possibly different) page of the list, preserving other filters */
    _navigateToListPage(newPage, newPerPage) {
        const meta = this._state.listMeta || {};
        const perPage = (newPerPage != null ? newPerPage : meta.perPage) || MEMORIES_DEFAULT_PER_PAGE;
        const page = Math.max(1, newPage || 1);

        const url = memoriesDsapBuildListUrl({
            page,
            perPage,
            search: meta.search || '',
            category: meta.category || ''
        });

        if (typeof this._state.host.navigate === 'function') {
            this._state.host.navigate(url);
        } else {
            void this._loadPagedList({ page, perPage, search: meta.search, category: meta.category });
        }
    },

    /** Go back to the list, trying to restore the list context that was active when we opened the detail */
    _navigateBackToList() {
        const host = this._state.host;
        // The detail URL may have carried list params in its query string
        const page = parseInt(host.getQueryParam('page') || '1', 10) || 1;
        const perPage = parseInt(host.getQueryParam('perPage') || String(MEMORIES_DEFAULT_PER_PAGE), 10) || MEMORIES_DEFAULT_PER_PAGE;
        const search = host.getQueryParam('search') || '';
        const category = host.getQueryParam('category') || '';

        const url = memoriesDsapBuildListUrl({ page, perPage, search, category });
        if (typeof host.navigate === 'function') {
            host.navigate(url);
        } else {
            this._showList();
        }
    },

    // _renderList / _filterAndRenderList removed — we now use server-side paging via _renderPagedList

    _showEmpty(msg) {
        const root = this._state.host.getRoot();
        const list = root.querySelector('#memoriesList');
        const loading = root.querySelector('#memoriesLoading');
        const empty = root.querySelector('#memoriesEmpty');
        if (loading) loading.classList.add('hidden');
        if (list) list.classList.add('hidden');
        if (empty) {
            empty.classList.remove('hidden');
            empty.innerHTML = `<span>${memoriesDsapEscapeHtml(msg || 'No memories')}</span>`;
        }
    },

    _renderDetails() {
        const root = this._state.host.getRoot();
        const mem = this._state.current;
        if (!root || !mem) return;

        const setText = (id, val) => {
            const el = root.querySelector('#' + id);
            if (el) el.textContent = val != null && val !== '' ? val : '—';
        };

        setText('memoriesDetailName', mem.name);
        setText('memoriesDetailDesc', mem.description);
        setText('memoriesDetailCategory', mem.category || 'Uncategorized');
        setText('memoriesDetailConfidence', ((mem.confidence || 0) * 100).toFixed(0) + '%');
        setText('memoriesDetailUsage', mem.usage_count || 0);
        setText('memoriesDetailLastUsed', mem.last_used_at ? memoriesDsapFormatDate(mem.last_used_at) : 'Never');

        // Title in toolbar
        const titleEl = root.querySelector('#memoriesDetailsTitle');
        if (titleEl) titleEl.textContent = mem.name || 'Memory';

        // Populate structured sections
        this._renderEntities();
        this._renderRelations();
        this._renderObservations();

        this._updateEditUI();
    },

    _updateEditUI() {
        const root = this._state.host.getRoot();
        const isEdit = this._state.isEdit;

        const toggle = (id, show) => {
            const el = root.querySelector('#' + id);
            if (el) el.classList.toggle('hidden', !show);
        };

        // display vs edit
        toggle('memoriesDetailName', !isEdit);
        toggle('memoriesDetailNameEdit', isEdit);
        toggle('memoriesDetailDesc', !isEdit);
        toggle('memoriesDetailDescEdit', isEdit);
        toggle('memoriesDetailCategory', !isEdit);
        toggle('memoriesDetailCategoryEdit', isEdit);
        toggle('memoriesDetailConfidence', !isEdit);
        toggle('memoriesDetailConfidenceEdit', isEdit);

        // buttons
        toggle('memoriesEditBtn', !isEdit);
        toggle('memoriesSaveBtn', isEdit);
        toggle('memoriesCancelBtn', isEdit);
        toggle('memoriesDeleteBtn', !isEdit);

        // add buttons
        toggle('memoriesAddEntityBtn', isEdit);
        toggle('memoriesAddRelationBtn', isEdit);
        toggle('memoriesAddObsBtn', isEdit);

        // populate edit fields when entering
        if (isEdit && this._state.current) {
            const m = this._state.current;
            const nameI = root.querySelector('#memoriesDetailNameEdit');
            const descI = root.querySelector('#memoriesDetailDescEdit');
            const catI = root.querySelector('#memoriesDetailCategoryEdit');
            const confI = root.querySelector('#memoriesDetailConfidenceEdit');
            if (nameI) nameI.value = m.name || '';
            if (descI) descI.value = m.description || '';
            if (catI) catI.value = m.category || '';
            if (confI) confI.value = (m.confidence || 0);
        }
    },

    _enterEdit() {
        if (!this._state.current) return;
        this._state.isEdit = true;
        this._state.original = JSON.parse(JSON.stringify(this._state.current));
        this._renderDetails();
        this._updateEditUI();
    },

    _exitEdit(revert = false) {
        if (revert && this._state.original) {
            this._state.current = JSON.parse(JSON.stringify(this._state.original));
        }
        this._state.isEdit = false;
        this._state.original = null;
        this._renderDetails();
        this._updateEditUI();
    },

    _collectForm() {
        const root = this._state.host.getRoot();
        const m = this._state.current;
        if (!m) return null;

        const data = { name: m.name, updates: {} };

        const getVal = (id) => {
            const el = root.querySelector('#' + id);
            return el ? el.value.trim() : '';
        };

        const newName = getVal('memoriesDetailNameEdit');
        if (newName) data.updates.name = newName;
        data.updates.description = getVal('memoriesDetailDescEdit') || '';
        data.updates.category = getVal('memoriesDetailCategoryEdit') || null;

        const confStr = getVal('memoriesDetailConfidenceEdit');
        const conf = parseFloat(confStr);
        if (!isNaN(conf) && conf >= 0 && conf <= 1) data.updates.confidence = conf;

        // entities
        const ents = [];
        root.querySelectorAll('#memoriesEntities .memories-entity-card').forEach((card) => {
            const name = card.querySelector('.ent-name')?.value?.trim();
            if (!name) return;
            const type = card.querySelector('.ent-type')?.value?.trim() || '';
            let attrs = {};
            const attrsTa = card.querySelector('.ent-attrs');
            if (attrsTa && attrsTa.value.trim()) {
                try { attrs = JSON.parse(attrsTa.value.trim()); } catch (_) {}
            }
            ents.push({ name, type, attributes: attrs });
        });
        data.updates.entities = ents;

        // relations
        const rels = [];
        root.querySelectorAll('#memoriesRelations .memories-relation-card').forEach((card) => {
            const from = card.querySelector('.rel-from')?.value?.trim();
            const type = card.querySelector('.rel-type')?.value?.trim();
            const to = card.querySelector('.rel-to')?.value?.trim();
            if (!from || !type || !to) return;
            const wStr = card.querySelector('.rel-weight')?.value;
            const weight = wStr != null ? (parseFloat(wStr) || 1) : 1;
            rels.push({ from, type, to, weight });
        });
        data.updates.relations = rels;

        // observations
        const obs = [];
        root.querySelectorAll('#memoriesObservations .memories-obs-card').forEach((card) => {
            const content = card.querySelector('.obs-content')?.value?.trim();
            if (!content) return;
            const impStr = card.querySelector('.obs-imp')?.value;
            const importance = impStr != null ? (parseFloat(impStr) || 0.5) : 0.5;
            obs.push({ content, importance });
        });
        data.updates.observations = obs;

        return data;
    },

    async _save() {
        const root = this._state.host.getRoot();
        const form = this._collectForm();
        if (!form) return;

        const newName = form.updates.name || this._state.current.name;
        if (!newName) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Name is required');
            return;
        }

        try {
            const resp = await window.wsClient.sendMessage('update_knowledge_memory', {
                name: this._state.current.name,
                updates: form.updates
            });
            if (resp && resp.success) {
                // apply locally
                Object.assign(this._state.current, form.updates);
                if (form.updates.name) this._state.current.name = form.updates.name;

                this._exitEdit(false);
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Memory updated');

                // After edit we stay on the detail. If the name changed, the user can use browser back
                // or we could optionally navigate to the new detail URL. For now we just re-render.
            } else {
                if (typeof showGlassToast === 'function') showGlassToast('error', null, resp?.error || 'Update failed');
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Error saving memory');
        }
    },

    async _deleteCurrent() {
        const mem = this._state.current;
        if (!mem) return;

        const ok = await showConfirmationDialog(
            `Delete memory "${mem.name}"? This cannot be undone.`,
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        if (!ok) return;

        try {
            const resp = await window.wsClient.sendMessage('delete_knowledge_memory', { name: mem.name });
            if (resp && resp.success) {
                this._state.current = null;
                if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Memory deleted');

                // Navigate back to the list context we came from (best UX with history)
                this._navigateBackToList();
            } else {
                if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Delete failed');
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Error deleting');
        }
    },

    // We prefer host.navigate for view switches so the address bar and history are updated.
    // These are kept only as very last-resort fallbacks inside the detail view.
    _showList() {
        const root = this._state.host.getRoot();
        root.querySelector('#memoriesListView')?.classList.remove('hidden');
        root.querySelector('#memoriesDetailsView')?.classList.add('hidden');
        const statsBar = root.querySelector('#memoriesStatsBar');
        if (statsBar) statsBar.style.display = '';
        const rulesBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesBtn) rulesBtn.style.display = '';
        const headerRight = root.querySelector('#memoriesHeaderRight');
        if (headerRight) headerRight.textContent = 'Data Management';
        this._state.current = null;
        this._state.isEdit = false;
    },

    _showDetails() {
        const root = this._state.host.getRoot();
        root.querySelector('#memoriesListView')?.classList.add('hidden');
        root.querySelector('#memoriesDetailsView')?.classList.remove('hidden');
        const statsBar = root.querySelector('#memoriesStatsBar');
        if (statsBar) statsBar.style.display = 'none';
        const rulesBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesBtn) rulesBtn.style.display = 'none';
    },

    // --- Edit builders (entities, relations, obs) ---

    _renderEntities() {
        const root = this._state.host.getRoot();
        const container = root.querySelector('#memoriesEntities');
        if (!container) return;
        container.innerHTML = '';
        const ents = this._state.current?.entities || [];
        const isEdit = this._state.isEdit;

        if (!ents.length && !isEdit) {
            container.innerHTML = '<div style="color:#222222;font-size:11pt;padding:4px 2px;">No entities</div>';
            return;
        }

        ents.forEach((ent, idx) => {
            const card = document.createElement('div');
            card.className = 'memories-entity-card';

            if (isEdit) {
                const attrsJson = ent.attributes && Object.keys(ent.attributes).length ? JSON.stringify(ent.attributes, null, 2) : '{}';
                card.innerHTML = `
                    <div class="memories-edit-row">
                        <input class="memories-input ent-name" value="${memoriesDsapEscapeAttr(ent.name || '')}" placeholder="Name">
                        <input class="memories-input ent-type" value="${memoriesDsapEscapeAttr(ent.type || '')}" placeholder="Type" style="width:110px">
                        <button type="button" class="memories-remove-btn" data-idx="${idx}">✕</button>
                    </div>
                    <textarea class="memories-input ent-attrs" style="margin-top:4px;font-family:monospace;font-size:11pt;min-height:400px;">${memoriesDsapEscapeHtml(attrsJson)}</textarea>
                `;
                card.querySelector('.memories-remove-btn').addEventListener('click', () => this._removeEntity(idx));
            } else {
                const attrs = ent.attributes && Object.keys(ent.attributes).length
                    ? `<div class="memories-entity-attrs">${memoriesDsapEscapeHtml(JSON.stringify(ent.attributes, null, 2))}</div>`
                    : '';
                card.innerHTML = `
                    <div class="memories-entity-head">
                        <span class="memories-entity-name">${memoriesDsapEscapeHtml(ent.name)}</span>
                        ${ent.type ? `<span class="memories-entity-type">${memoriesDsapEscapeHtml(ent.type)}</span>` : ''}
                    </div>
                    ${attrs}
                `;
            }
            container.appendChild(card);
        });
    },

    _addEntity() {
        if (!this._state.current) return;
        if (!this._state.current.entities) this._state.current.entities = [];
        this._state.current.entities.push({ name: '', type: '', attributes: {} });
        this._renderEntities();
    },
    _removeEntity(idx) {
        if (!this._state.current?.entities) return;
        this._state.current.entities.splice(idx, 1);
        this._renderEntities();
    },

    _renderRelations() {
        const root = this._state.host.getRoot();
        const container = root.querySelector('#memoriesRelations');
        if (!container) return;
        container.innerHTML = '';
        const rels = this._state.current?.relations || [];
        const isEdit = this._state.isEdit;

        if (!rels.length && !isEdit) {
            container.innerHTML = '<div style="color:#222222;font-size:11pt;padding:4px 2px;">No relations</div>';
            return;
        }

        rels.forEach((rel, idx) => {
            const card = document.createElement('div');
            card.className = 'memories-relation-card';

            if (isEdit) {
                card.innerHTML = `
                    <div class="memories-edit-row">
                        <input class="memories-input rel-from" value="${memoriesDsapEscapeAttr(rel.from || '')}" placeholder="From">
                        <input class="memories-input rel-type" value="${memoriesDsapEscapeAttr(rel.type || '')}" placeholder="Type" style="width:90px">
                        <input class="memories-input rel-to" value="${memoriesDsapEscapeAttr(rel.to || '')}" placeholder="To">
                        <input class="memories-input rel-weight" type="number" step="0.1" min="0" max="1" value="${rel.weight != null ? rel.weight : 1}" style="width:58px" title="Weight">
                        <button type="button" class="memories-remove-btn" data-idx="${idx}">✕</button>
                    </div>
                `;
                card.querySelector('.memories-remove-btn').addEventListener('click', () => this._removeRelation(idx));
            } else {
                const w = (rel.weight != null && rel.weight !== 1) ? ` <span style="opacity:.6">(${Number(rel.weight).toFixed(2)})</span>` : '';
                card.innerHTML = `
                    <div>
                        <span class="memories-rel-from">${memoriesDsapEscapeHtml(rel.from)}</span>
                        <span class="memories-rel-arrow">→</span>
                        <span class="memories-rel-type">${memoriesDsapEscapeHtml(rel.type)}</span>
                        <span class="memories-rel-arrow">→</span>
                        <span class="memories-rel-to">${memoriesDsapEscapeHtml(rel.to)}</span>${w}
                    </div>
                `;
            }
            container.appendChild(card);
        });
    },

    _addRelation() {
        if (!this._state.current) return;
        if (!this._state.current.relations) this._state.current.relations = [];
        this._state.current.relations.push({ from: '', type: '', to: '', weight: 1.0 });
        this._renderRelations();
    },
    _removeRelation(idx) {
        if (!this._state.current?.relations) return;
        this._state.current.relations.splice(idx, 1);
        this._renderRelations();
    },

    _renderObservations() {
        const root = this._state.host.getRoot();
        const container = root.querySelector('#memoriesObservations');
        if (!container) return;
        container.innerHTML = '';
        const obs = this._state.current?.observations || [];
        const isEdit = this._state.isEdit;

        if (!obs.length && !isEdit) {
            container.innerHTML = '<div style="color:#222222;font-size:11pt;padding:4px 2px;">No observations</div>';
            return;
        }

        obs.forEach((o, idx) => {
            const card = document.createElement('div');
            card.className = 'memories-obs-card';

            if (isEdit) {
                card.innerHTML = `
                    <textarea class="memories-input obs-content" style="min-height:400px;">${memoriesDsapEscapeHtml(o.content || '')}</textarea>
                    <div class="memories-edit-row" style="margin-top:3px">
                        <input class="memories-input obs-imp" type="number" step="0.05" min="0" max="1" value="${o.importance != null ? o.importance : 0.5}" style="width:70px" title="Importance">
                        <button type="button" class="memories-remove-btn" data-idx="${idx}">✕</button>
                    </div>
                `;
                card.querySelector('.memories-remove-btn').addEventListener('click', () => this._removeObservation(idx));
            } else {
                const imp = o.importance != null ? `<div class="memories-obs-imp">Importance: ${(o.importance * 100).toFixed(0)}%</div>` : '';
                card.innerHTML = `<div class="memories-obs-content">${memoriesDsapEscapeHtml(o.content || '')}</div>${imp}`;
            }
            container.appendChild(card);
        });
    },

    _addObservation() {
        if (!this._state.current) return;
        if (!this._state.current.observations) this._state.current.observations = [];
        this._state.current.observations.push({ content: '', importance: 0.5 });
        this._renderObservations();
    },
    _removeObservation(idx) {
        if (!this._state.current?.observations) return;
        this._state.current.observations.splice(idx, 1);
        this._renderObservations();
    },

    // Category filter (simple custom dropdown) — now driven from stats.categories when we have a list load
    _wireCategoryDropdown(root) {
        const btn = root.querySelector('#memoriesCategoryBtn');
        const label = root.querySelector('#memoriesCategoryLabel');
        const menu = root.querySelector('#memoriesCategoryMenu');
        if (!btn || !menu) return;

        const rebuildMenu = () => {
            const statsCats = (this._state.lastStats && this._state.lastStats.categories) || [];
            const catNames = statsCats.map(c => c.category).filter(Boolean);
            const cats = ['All Categories', ...catNames.sort()];
            const currentCat = (this._state.listMeta && this._state.listMeta.category) || null;

            menu.innerHTML = '';
            cats.forEach(cat => {
                const val = (cat === 'All Categories') ? null : cat;
                const div = document.createElement('div');
                div.className = 'memories-dd-item' + (val === currentCat ? ' selected' : '');
                div.textContent = cat;
                div.addEventListener('click', (e) => {
                    e.stopImmediatePropagation();
                    menu.classList.add('hidden');

                    // Navigate with new category (reset page to 1)
                    const meta = this._state.listMeta || {};
                    const url = memoriesDsapBuildListUrl({
                        page: 1,
                        perPage: meta.perPage || MEMORIES_DEFAULT_PER_PAGE,
                        search: meta.search || '',
                        category: val || ''
                    });
                    if (typeof this._state.host.navigate === 'function') {
                        this._state.host.navigate(url);
                    } else {
                        void this._loadPagedList({ page: 1, perPage: meta.perPage, search: meta.search, category: val });
                    }
                });
                menu.appendChild(div);
            });
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            rebuildMenu();
            const isHidden = menu.classList.contains('hidden');
            document.querySelectorAll('.memories-dropdown-menu').forEach(m => m.classList.add('hidden'));
            menu.classList.toggle('hidden', !isHidden);
        });

        // close on outside click
        document.addEventListener('click', (e) => {
            if (!root.contains(e.target)) menu.classList.add('hidden');
        }, { capture: true, once: false });
    },

    // Simple wire for the list view's "Delete Memories..." button:
    // Opens the dedicated /delete sub-page (no more flyout dropdown).
    _wireBulkDeleteButton(root, host) {
        const btn = root.querySelector('#memoriesBulkDeleteBtn');
        if (!btn) return;

        // Remove any old dropdown listeners by replacing the node (simple & safe)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = `dsap://${MEMORIES_DSAP_URL}/delete`;
            if (typeof host.navigate === 'function') {
                host.navigate(target);
            } else if (typeof openDsapInGrimoire === 'function') {
                openDsapInGrimoire(target);
            }
        });
    },

    // --- Delete / Bulk selector page support ---

    _showDeleteView() {
        const root = this._state.host.getRoot();
        if (!root) return;

        // Hide other views
        root.querySelector('#memoriesListView')?.classList.add('hidden');
        root.querySelector('#memoriesDetailsView')?.classList.add('hidden');
        const delView = root.querySelector('#memoriesDeleteView');
        if (delView) delView.classList.remove('hidden');

        // Hide the bulk footer button while on the delete page
        const bulkWrap = root.querySelector('.memories-bulk');
        if (bulkWrap) bulkWrap.style.display = 'none';

        const statsBar = root.querySelector('#memoriesStatsBar');
        if (statsBar) statsBar.style.display = 'none';
        const rulesBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesBtn) rulesBtn.style.display = 'none';

        // Reset UI state for the delete page
        this._state.deleteSelectedFilter = null;
        this._state.deleteCount = 0;

        const countPanel = root.querySelector('#memoriesDeleteCountPanel');
        if (countPanel) countPanel.style.opacity = '0.6';

        const countVal = root.querySelector('#memoriesDeleteCountValue');
        if (countVal) countVal.textContent = '—';

        const countDesc = root.querySelector('#memoriesDeleteCountDesc');
        if (countDesc) countDesc.textContent = 'Select a filter above to count';

        const doBtn = root.querySelector('#memoriesDoBulkDeleteBtn');
        if (doBtn) doBtn.disabled = true;

        // Clear any previous selection highlight
        root.querySelectorAll('#memoriesDeleteOptions .memories-delete-option').forEach(el => {
            el.classList.remove('selected');
        });

        // Wire the delete page controls (idempotent-ish)
        this._wireDeletePageControls(root);

        // Optional direct link pre-selection: dsap://.../delete?filter=low_confidence
        const hostForParam = this._state.host;
        const preFilter = hostForParam && typeof hostForParam.getQueryParam === 'function'
            ? (hostForParam.getQueryParam('filter') || hostForParam.getQueryParam('type'))
            : null;
        if (preFilter) {
            const matchOpt = root.querySelector(`#memoriesDeleteOptions .memories-delete-option[data-filter="${preFilter}"]`);
            if (matchOpt) {
                setTimeout(() => this._selectDeleteFilter(root, preFilter, matchOpt), 40);
            }
        }
    },

    _wireDeletePageControls(root) {
        const cancelBtn = root.querySelector('#memoriesDeleteCancelBtn');
        if (cancelBtn) {
            cancelBtn.onclick = () => this._navigateBackToList();
        }

        const doBtn = root.querySelector('#memoriesDoBulkDeleteBtn');
        if (doBtn) {
            doBtn.onclick = () => this._performBulkDeleteFromPage();
        }

        // Option cards
        const options = root.querySelectorAll('#memoriesDeleteOptions .memories-delete-option');
        options.forEach(opt => {
            opt.onclick = () => {
                const filterType = opt.dataset.filter;
                this._selectDeleteFilter(root, filterType, opt);
            };
        });
    },

    async _selectDeleteFilter(root, filterType, optEl) {
        // Highlight
        root.querySelectorAll('#memoriesDeleteOptions .memories-delete-option').forEach(el => el.classList.remove('selected'));
        if (optEl) optEl.classList.add('selected');

        this._state.deleteSelectedFilter = filterType;

        const countVal = root.querySelector('#memoriesDeleteCountValue');
        const countDesc = root.querySelector('#memoriesDeleteCountDesc');
        const countPanel = root.querySelector('#memoriesDeleteCountPanel');
        const doBtn = root.querySelector('#memoriesDoBulkDeleteBtn');

        if (countVal) countVal.textContent = '...';
        if (countDesc) countDesc.textContent = 'Counting...';
        if (countPanel) countPanel.style.opacity = '1';
        if (doBtn) doBtn.disabled = true;

        const descriptions = {
            low_confidence: 'Low Confidence (< 30%)',
            old_usage: '>30 Days Usage',
            never_used: 'Never Used',
            everything: 'Everything (all memories)'
        };

        try {
            const resp = await window.wsClient.sendMessage('count_knowledge_memories_by_filter', { filterType });
            const count = (resp && resp.success) ? (resp.count || 0) : 0;
            this._state.deleteCount = count;

            if (countVal) countVal.textContent = count.toLocaleString();
            if (countDesc) countDesc.textContent = descriptions[filterType] || filterType;

            if (doBtn) {
                doBtn.disabled = (count === 0);
                doBtn.innerHTML = count > 0
                    ? `<i class="fas fa-trash"></i> <span>Delete ${count.toLocaleString()} memories</span>`
                    : `<i class="fas fa-trash"></i> <span>Nothing to delete</span>`;
            }
        } catch (e) {
            if (countVal) countVal.textContent = '—';
            if (countDesc) countDesc.textContent = 'Failed to count';
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Failed to count matching memories');
        }
    },

    async _performBulkDeleteFromPage() {
        const filterType = this._state.deleteSelectedFilter;
        if (!filterType) return;

        const count = this._state.deleteCount || 0;
        const descriptions = {
            low_confidence: 'Low Confidence (< 30%)',
            old_usage: '>30 Days Usage',
            never_used: 'Never Used',
            everything: 'Everything (all memories)'
        };
        const desc = descriptions[filterType] || filterType;

        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete ${count} memor${count === 1 ? 'y' : 'ies'} matching "${desc}"? This action cannot be undone.`,
            [
                { text: 'Delete', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        );
        if (!confirmed) return;

        try {
            const delResp = await window.wsClient.sendMessage('delete_knowledge_memories_by_filter', { filterType });
            if (delResp && delResp.success) {
                const deleted = delResp.deletedCount || 0;
                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', null, `Deleted ${deleted} memor${deleted === 1 ? 'y' : 'ies'}`);
                }
                // Go back to the main list (page 1 of current context or root)
                this._navigateBackToList();
            } else {
                if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Bulk delete failed');
            }
        } catch (e) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Error during bulk delete');
        }
    },

    // === Static Rules (Director Rules + Feedback) ===

    async _showStaticRulesView(view = 'rules') {
        const root = this._state.host.getRoot();
        if (!root) return;

        // Hide other main views
        root.querySelector('#memoriesListView')?.classList.add('hidden');
        root.querySelector('#memoriesDetailsView')?.classList.add('hidden');
        root.querySelector('#memoriesDeleteView')?.classList.add('hidden');

        const rulesView = root.querySelector('#memoriesStaticRulesView');
        if (rulesView) rulesView.classList.remove('hidden');

        // Ensure bulk hidden
        const bulkWrap = root.querySelector('.memories-bulk');
        if (bulkWrap) bulkWrap.style.display = 'none';

        const statsBar = root.querySelector('#memoriesStatsBar');
        if (statsBar) statsBar.style.display = 'none';
        const rulesBtn = root.querySelector('#memoriesStaticRulesBtn');
        if (rulesBtn) rulesBtn.style.display = 'none';

        this._state.staticRulesView = view;
        this._state.directorRules = this._state.directorRules || [];
        this._state.directorFeedback = this._state.directorFeedback || [];

        const headerRight = root.querySelector('#memoriesHeaderRight');
        if (headerRight) headerRight.textContent = 'Rules & Constraints';

        const subTitle = root.querySelector('#memoriesStaticRulesTitle');
        if (subTitle) subTitle.textContent = (view === 'feedback') ? 'Director Feedback' : 'Director Rules';

        // Wire back and switcher
        this._wireStaticRulesControls(root);

        // Load data for the chosen view
        if (view === 'feedback') {
            await this._loadDirectorFeedback();
            this._renderDirectorFeedbackList(root);
        } else {
            await this._loadDirectorRules();
            this._renderDirectorRulesList(root);
        }

        this._updateStaticRulesUI(root);

        // Note: stats bar is hidden on sub views per design (only on main list)
    },

    _wireStaticRulesControls(root) {
        // Add rule button (only meaningful for rules view)
        const addBtn = root.querySelector('#memoriesAddStaticRuleBtn');
        if (addBtn && !addBtn._wired) {
            addBtn._wired = true;
            addBtn.addEventListener('click', () => this._addDirectorRule(root));
        }

        // Rules / Feedback switcher (Linksys segmented control style)
        root.querySelectorAll('[data-rules-view]').forEach(btn => {
            if (btn._wired) return;
            btn._wired = true;
            btn.addEventListener('click', () => {
                const v = btn.dataset.rulesView;
                const target = v === 'feedback'
                    ? `dsap://${MEMORIES_DSAP_URL}/static_rules/feedback`
                    : `dsap://${MEMORIES_DSAP_URL}/static_rules`;
                if (typeof this._state.host.navigate === 'function') {
                    this._state.host.navigate(target);
                } else {
                    this._showStaticRulesView(v);
                }
            });
        });
    },

    _updateStaticRulesUI(root) {
        const view = this._state.staticRulesView || 'rules';
        const addBtn = root.querySelector('#memoriesAddStaticRuleBtn');

        // Add button only makes sense for the Rules (not Feedback) view
        if (addBtn) addBtn.style.display = (view === 'rules') ? '' : 'none';

        // Highlight active in switcher (retro bevel look)
        root.querySelectorAll('[data-rules-view]').forEach(btn => {
            const isActive = btn.dataset.rulesView === view;
            if (isActive) {
                btn.style.background = '#003366';
                btn.style.color = '#fff';
                btn.style.border = '1px solid #000033';
            } else {
                btn.style.background = '';
                btn.style.color = '';
                btn.style.border = '';
            }
        });
    },

    async _loadDirectorRules() {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) return;
            const result = await window.wsClient.sendMessage('director_load_rules', {});
            if (result && result.data && result.data.success) {
                this._state.directorRules = result.data.rules || [];
            } else {
                this._state.directorRules = [];
            }
        } catch (e) {
            console.error('DSAP static rules load error', e);
            this._state.directorRules = [];
        }
    },

    async _loadDirectorFeedback() {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) return;
            const result = await window.wsClient.sendMessage('director_load_feedback', {});
            if (result && result.data && result.data.success) {
                this._state.directorFeedback = result.data.feedback || [];
            } else {
                this._state.directorFeedback = [];
            }
        } catch (e) {
            this._state.directorFeedback = [];
        }
    },

    _renderDirectorRulesList(root) {
        const list = root.querySelector('#memoriesStaticRulesList');
        if (!list) return;
        const rules = this._state.directorRules || [];

        if (rules.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="padding:12px;text-align:center;color:#222222;">
                    <i class="fas fa-book-open"></i>
                    <p style="margin:4px 0;">No static rules defined yet.</p>
                    <p style="font-size:11pt;opacity:0.7;">Use the Add button to create one.</p>
                </div>`;
            return;
        }

        list.innerHTML = rules.map((rule, index) => `
            <div class="memories-static-rule-item" data-rule-id="${rule.id}">
                <div class="memories-static-rule-content">
                    <div class="memories-static-rule-text" contenteditable="true" data-rule-index="${index}">${memoriesDsapEscapeHtml(rule.text)}</div>
                    <div class="memories-static-rule-actions">
                        <button type="button" class="memories-remove-btn" data-rule-id="${rule.id}" title="Delete Rule">✕</button>
                    </div>
                </div>
            </div>
        `).join('');

        // Wire editing
        list.querySelectorAll('.memories-static-rule-text').forEach(el => {
            el.addEventListener('blur', (e) => this._handleDirectorRuleEdit(root, e));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
            });
        });

        // Wire deletes
        list.querySelectorAll('.memories-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => this._deleteDirectorRule(root, btn.dataset.ruleId));
        });
    },

    async _handleDirectorRuleEdit(root, e) {
        const el = e.target;
        const index = parseInt(el.dataset.ruleIndex, 10);
        const newText = el.textContent.trim();
        if (!newText) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Rule text cannot be empty.');
            this._renderDirectorRulesList(root);
            return;
        }
        this._state.directorRules[index].text = newText;
        await this._saveDirectorRules();
    },

    async _addDirectorRule(root) {
        const newRule = {
            id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: 'New rule - click to edit',
            created: new Date().toISOString()
        };
        this._state.directorRules = this._state.directorRules || [];
        this._state.directorRules.push(newRule);
        this._renderDirectorRulesList(root);

        // Focus the new one
        setTimeout(() => {
            const newEl = root.querySelector(`[data-rule-id="${newRule.id}"] .memories-static-rule-text`);
            if (newEl) {
                newEl.focus();
                const range = document.createRange();
                range.selectNodeContents(newEl);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 60);

        await this._saveDirectorRules();
    },

    async _deleteDirectorRule(root, ruleId) {
        const ok = await showConfirmationDialog('Delete this static rule?', [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok) return;

        this._state.directorRules = (this._state.directorRules || []).filter(r => r.id !== ruleId);
        this._renderDirectorRulesList(root);
        await this._saveDirectorRules();
        if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Rule deleted.');
    },

    async _saveDirectorRules() {
        try {
            if (!window.wsClient || !window.wsClient.isConnected()) return;
            await window.wsClient.sendMessage('director_save_rules', {
                rules: this._state.directorRules || []
            });
        } catch (e) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Failed to save rules');
        }
    },

    _renderDirectorFeedbackList(root) {
        const list = root.querySelector('#memoriesStaticRulesList');
        if (!list) return;
        const fb = this._state.directorFeedback || [];

        if (!fb.length) {
            list.innerHTML = `
                <div class="empty-state" style="padding:12px;text-align:center;color:#222222;">
                    <i class="fas fa-comment-alt"></i>
                    <p style="margin:4px 0;">No feedback entries yet.</p>
                </div>`;
            return;
        }

        list.innerHTML = fb.map((f) => {
            const date = f.timestamp ? new Date(f.timestamp).toLocaleDateString() : 'Unknown';
            const sel = memoriesDsapEscapeHtml(f.select_text || '');
            const rep = memoriesDsapEscapeHtml(f.replace_text || '');
            const reason = memoriesDsapEscapeHtml(f.ai_reason || '');
            const userFb = memoriesDsapEscapeHtml(f.user_feedback || '');
            return `
                <div class="memories-static-feedback-item" data-feedback-id="${f.id}">
                    <div class="memories-static-rule-content" style="flex-direction:column; align-items:stretch;">
                        <div style="display:flex; justify-content:space-between; font-size:10pt; color:#222222;">
                            <span><i class="fas fa-calendar-alt"></i> ${date}</span>
                            ${f.action ? `<span>${memoriesDsapEscapeHtml(f.action)}</span>` : ''}
                        </div>
                        <div class="memories-static-rule-text" contenteditable="true" data-feedback-id="${f.id}" style="min-height:50px;">${userFb || '(no feedback)'}</div>
                        <div class="memories-static-feedback-details">
                            ${sel ? `<div>Original: ${sel}</div>` : ''}
                            ${rep ? `<div>Replaced: ${rep}</div>` : ''}
                            ${reason ? `<div>AI: ${reason}</div>` : ''}
                        </div>
                        <div style="text-align:right; margin-top:2px;">
                            <button type="button" class="memories-remove-btn" data-feedback-id="${f.id}" title="Delete">✕</button>
                        </div>
                    </div>
                </div>`;
        }).join('');

        // Wire feedback text edit
        list.querySelectorAll('.memories-static-rule-text[data-feedback-id]').forEach(el => {
            el.addEventListener('blur', (e) => this._handleDirectorFeedbackEdit(root, e));
        });

        // Wire deletes
        list.querySelectorAll('.memories-remove-btn[data-feedback-id]').forEach(btn => {
            btn.addEventListener('click', () => this._deleteDirectorFeedback(root, btn.dataset.feedbackId));
        });
    },

    async _handleDirectorFeedbackEdit(root, e) {
        const el = e.target;
        const id = el.dataset.feedbackId;
        const newText = el.textContent.trim();
        const fb = this._state.directorFeedback || [];
        const item = fb.find(x => x.id === id);
        if (item) {
            item.user_feedback = newText;
            // Persist via the feedback save endpoint if it exists, otherwise rules save is separate
            try {
                if (window.wsClient) {
                    await window.wsClient.sendMessage('director_save_feedback', { feedback: fb });
                }
            } catch (_) {}
        }
    },

    async _deleteDirectorFeedback(root, fbId) {
        const ok = await showConfirmationDialog('Delete this feedback entry?', [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]);
        if (!ok) return;

        try {
            if (window.wsClient) {
                await window.wsClient.sendMessage('director_delete_feedback', { feedbackId: fbId });
            }
            this._state.directorFeedback = (this._state.directorFeedback || []).filter(f => f.id !== fbId);
            this._renderDirectorFeedbackList(root);
            if (typeof showGlassToast === 'function') showGlassToast('success', null, 'Feedback deleted.');
        } catch (e) {
            if (typeof showGlassToast === 'function') showGlassToast('error', null, 'Failed to delete feedback');
        }
    },

    _repurposeStatsBarForRulesToggle(root) {
        const bar = root.querySelector('#memoriesStatsBar');
        if (!bar) return;

        const currentView = this._state.staticRulesView || 'rules';

        // Replace the counts with the toggle (the memory counts info does not apply to this view)
        bar.innerHTML = `
            <div class="memories-stat-pill" style="background:transparent;border:none;font-weight:600;opacity:0.9;">Static Rules</div>
            <div class="memories-stat-pill memories-stat-action ${currentView === 'rules' ? 'active' : ''}" data-rules-toggle="rules" style="cursor:pointer;">Rules</div>
            <div class="memories-stat-pill memories-stat-action ${currentView === 'feedback' ? 'active' : ''}" data-rules-toggle="feedback" style="cursor:pointer;">Feedback</div>
        `;

        bar.querySelectorAll('[data-rules-toggle]').forEach(el => {
            el.addEventListener('click', () => {
                const v = el.dataset.rulesToggle;
                const targetUrl = v === 'feedback'
                    ? `dsap://${MEMORIES_DSAP_URL}/static_rules/feedback`
                    : `dsap://${MEMORIES_DSAP_URL}/static_rules`;
                if (typeof this._state.host.navigate === 'function') {
                    this._state.host.navigate(targetUrl);
                } else {
                    this._showStaticRulesView(v);
                }
            });
        });
    }
};

function registerMemoriesDsapApplet() {
    if (typeof registerDsap !== 'function') return;

    registerDsap({
        url: MEMORIES_DSAP_URL,
        getContent(match) {
            return {
                html: memoriesDsapBuildMemoriesHtml(),
                css: memoriesDsapScopedCss,
                drivers: memoriesDsapDriver,
                baseBackground: '#eeeeee'
            };
        }
    });
}

registerMemoriesDsapApplet();

// Compatibility shim so old toolbar / action buttons keep working even if old modal script is removed.
if (typeof window.openKnowledgeMemoriesModal !== 'function') {
    window.openKnowledgeMemoriesModal = function () {
        const target = `dsap://${MEMORIES_DSAP_URL}`;
        if (typeof openDsapInGrimoire === 'function') {
            openDsapInGrimoire(target);
            return;
        }
        // Retry a couple times in case DSAP registry loads slightly later
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            if (typeof openDsapInGrimoire === 'function') {
                clearInterval(t);
                openDsapInGrimoire(target);
            } else if (tries > 15) {
                clearInterval(t);
                console.warn('[memories-dsap] openDsapInGrimoire not available');
            }
        }, 80);
    };
}
