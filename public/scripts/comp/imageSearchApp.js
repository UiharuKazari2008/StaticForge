/**
 * Image Search (Yozora #828): the Vista desktop program that replaced the Global Search DSAP
 * (dsap://ispy.dreamscape.jp/, omegasearchDsapApplet.js). Modelled on Vista's Search window, measured
 * on the Vista VM (Start > Search, then Advanced Search, 800x600; captures in ~/.cache/vista-vm/search-ref):
 *
 *   title row       travel orbs, Recent Pages, the address ("Search Results in <workspace> > <view>",
 *                   a green fill while a search runs), refresh, the search box (vista-explorer.css draws
 *                   it, as Control Panel's and the Games folder's)
 *   Show only band  Images / Scraps / Pinned / Upscaled (the DSAP's view type) and Advanced Search
 *   Advanced Search the drop-down pane: Location (workspace scope and its corpus), date, models, sampler,
 *                   scheduler, resolution, steps / guidance / rescale, UC and NSFW (Vista trackbars),
 *                   prompt source, default match, quality, upscaled, dynamic replacements, consecutive
 *                   seeds; Search applies it
 *   search terms    the blocks (term1 | term2), each with its match mode menu and Remove
 *   command bar     Organize, Views (Extra Large Icons ... Tiles), Save Search, Search Tools, Prompt
 *                   Usages; Preview / Download with a picture selected; the photo frame's Save when a
 *                   Slide Show, the Photos screen saver or a SideShow device opened the search (frame=)
 *   panes           navigation (Favorite Links: All Workspaces, This Workspace, saved searches; the
 *                   Workspaces tree), the results (60 a page), the details pane (the selection's
 *                   metadata, or Matches / Showing / Usages)
 *   Properties      the picture's sheet: General (metadata and the DSAP's detail actions), Prompts
 *                   (Input / Final), Undesired Content, Expanders (text / Tendai)
 *
 * Server calls are the DSAP's: omegasearch_query and request_image_metadata. The DSAP's helpers
 * (omegasearchDsap*, OMEGASEARCH_*) are globals of omegasearchDsapApplet.js, loaded first by
 * openImageSearchWindow (dsapManifests.js); its search sessions (sessionStorage
 * ispy-dsap-search-sessions-v1) are shared, so a search survives a reopen. URL state is the DSAP's
 * query string (blocks, modes, view, viewType, workspace, filters, file, page, frame).
 * Styles: public/css/image-search.css.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const MODAL_ID = 'imageSearchModal';
    const PROPS_ID = 'imageSearchPropsModal';
    const EX = '/static_images/vista-explorer';
    const CMD = '/static_images/vista-cmdbar';
    const VI = '/static_images/vista-icons';
    const REG_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\Image Search';
    const GLOBAL_WS = '*';
    const PAGE_SIZE = 60;

    // Views, as Explorer's menu lists them (Explorer's icons: shell32 bitmaps 607-613)
    const VIEW_MODES = [
        { id: 'icons-xl', label: 'Extra Large Icons' },
        { id: 'icons-lg', label: 'Large Icons' },
        { id: 'icons-md', label: 'Medium Icons' },
        { id: 'icons-sm', label: 'Small Icons' },
        { id: 'list', label: 'List' },
        { id: 'details', label: 'Details' },
        { id: 'tiles', label: 'Tiles' }
    ];
    const VIEW_TYPES = [
        { value: 'images', label: 'Images' },
        { value: 'scraps', label: 'Scraps' },
        { value: 'pinned', label: 'Pinned' },
        { value: 'upscaled', label: 'Upscaled' }
    ];
    const MATCH_MODES = [
        { value: 'substring', label: 'Substring' },
        { value: 'word', label: 'Whole word' },
        { value: 'inner', label: 'Inner match' },
        { value: 'start', label: 'Starts with' },
        { value: 'end', label: 'Ends with' }
    ];
    const RESOLUTION_TIERS = [
        { value: 'normal', label: 'Normal' },
        { value: 'large', label: 'Large' },
        { value: 'max', label: 'Max / wallpaper' }
    ];
    const RELATIVE_DATES = [
        { value: '1d', label: 'Yesterday' },
        { value: '7d', label: 'Last week' },
        { value: '30d', label: 'Last month' },
        { value: '90d', label: 'Last 3 months' },
        { value: '1y', label: 'Last year' }
    ];
    const NSFW_LABELS = { '-2': 'Clense', '-1': 'Remove', 0: 'Neutral', 1: 'Allow', 2: 'Skimpy', 3: 'Nude' };
    const COLUMNS = [
        { id: 'name', label: 'Name', width: 190 },
        { id: 'date', label: 'Date modified', width: 120 },
        { id: 'dims', label: 'Dimensions', width: 90 },
        { id: 'size', label: 'Size', width: 70 },
        { id: 'type', label: 'Type', width: 100 }
    ];
    const USAGE_COLUMNS = [
        { id: 'block', label: 'Block', width: 130 },
        { id: 'location', label: 'Location', width: 150 },
        { id: 'text', label: 'Text', width: 280 },
        { id: 'files', label: 'Files', width: 60 }
    ];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const ws = () => (typeof wsClient !== 'undefined' && wsClient ? wsClient : null);
    const toast = (type, text, icon) => call('showGlassToast', type, 'Image Search', text, false, 3500, icon || null);
    const reg = (name, d) => (root.melatonRegistry ? root.melatonRegistry.get(REG_KEY, name, d) : d);
    const setReg = (values) => { if (root.melatonRegistry) void root.melatonRegistry.set(REG_KEY, values); };

    /** Explorer's sizes: bytes, then KB / MB to three significant figures. */
    function fmtSize(b) {
        const n = Number(b) || 0;
        if (!n) return '';
        if (n < 1024) return `${n} bytes`;
        const u = ['KB', 'MB', 'GB'];
        let v = n / 1024;
        let i = 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
        return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
    }

    /** Vista's short date and time: 11/13/2026 2:24 AM. */
    function fmtDate(t) {
        if (!t) return '';
        const d = new Date(typeof t === 'string' && /^\d+$/.test(t) ? Number(t) : t);
        if (Number.isNaN(d.getTime())) return '';
        const h = d.getHours();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${(h % 12) || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }

    function typeName(filename, meta) {
        const ext = (String(filename).match(/\.([a-z0-9]+)$/i) || [])[1] || '';
        const base = { png: 'PNG Image', jpg: 'JPEG Image', jpeg: 'JPEG Image', webp: 'WebP Image' }[ext.toLowerCase()] || `${ext.toUpperCase()} File`;
        return meta && meta.upscaled ? `${base} (upscaled)` : base;
    }

    function displayName(filename) {
        return String(filename || '').replace(/\.(png|jpe?g|webp)$/i, '');
    }

    function workspaceLabel(id) {
        if (!id || id === GLOBAL_WS) return 'All Workspaces';
        // omegasearchDsapWorkspaceLabel: public/scripts/comp/omegasearchDsapApplet.js
        return omegasearchDsapWorkspaceLabel(id);
    }

    function activeWs() {
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : null;
    }

    function modelName(key) {
        const k = String(key || '').toLowerCase();
        if (!k) return '';
        const badges = typeof modelBadges !== 'undefined' ? modelBadges : {};
        const names = typeof modelNames !== 'undefined' ? modelNames : {};
        const b = badges[k];
        if (b) return `NovelAI ${b.display_full || b.display || k}${b.badge_full || b.badge ? ` (${b.badge_full || b.badge})` : ''}`;
        return names[k] || key;
    }

    function samplerName(meta) {
        if (!meta || !meta.sampler) return '';
        if (typeof getSamplerMeta === 'function') {
            const s = getSamplerMeta(meta.sampler);
            if (s) return s.display_short || s.display || meta.sampler;
        }
        return meta.sampler;
    }

    /** A dsap:// URL's query read the way the DSAP's resolvers read a host. */
    function hostFor(url) {
        const raw = String(url || '');
        const qi = raw.indexOf('?');
        const q = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
        return { getQueryParam: (name) => q.get(name) };
    }

    // ---- the app -----------------------------------------------------------------------------------

    class ImageSearch {
        constructor() {
            this.history = [];
            this.future = [];
            this.metaCache = new Map();
            this.state = this.blankState();
            this.viewMode = reg('ViewMode', 'icons-lg');
            if (!VIEW_MODES.some((v) => v.id === this.viewMode)) this.viewMode = 'icons-lg';
            this.panes = {
                advanced: false,
                nav: reg('NavigationPane', true) !== false,
                details: reg('DetailsPane', true) !== false
            };
            this.sort = { field: null, dir: 'asc' };
            this.build();
        }

        blankState() {
            return {
                workspaceId: GLOBAL_WS,
                blocks: [],
                view: 'search',
                viewType: 'images',
                detailFile: null,
                filters: omegasearchDsapDefaultFilters(),
                blockOptions: omegasearchDsapDefaultBlockOptions(),
                promptSourceCompiled: true,
                promptSourceInput: true,
                page: 1,
                total: 0,
                results: [],
                usages: [],
                corpusSize: null,
                loading: false,
                searched: false,
                searchSessionId: null,
                serverSearchSessionId: null,
                frameId: null,
                selected: null,
                expandedUsages: new Set(),
                usagePromptCache: {}
            };
        }

        // ---- the window ----------------------------------------------------------------------------

        build() {
            const m = doc.createElement('div');
            m.id = MODAL_ID;
            m.className = 'modal hidden resizeable-window toolbar-visible image-search-window is-landing';
            m.dataset.windowIdentifier = 'image-search';
            m.dataset.windowClient = 'light';
            m.dataset.windowDefaultWidth = '800';
            m.dataset.windowDefaultHeight = '600';
            m.dataset.windowMinWidth = '520';
            m.dataset.windowMinHeight = '380';
            m.dataset.taskbarIcon = '/static_images/app_icons/vista-search.png';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Image Search');
            m.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main">
                        <img src="/static_images/app_icons/24/vista-search.webp" srcset="/static_images/app_icons/24/vista-search.webp 1x, /static_images/app_icons/48/vista-search.webp 2x" alt="" class="icon-image">
                        <span class="cpl-window-title isx-window-title">Search Results</span>
                    </div>
                    <div class="modal-window-title-toolbar">
                        <div class="button-group naxt-nav-group">
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-back" title="Back" disabled><i class="fas fa-arrow-left"></i></button>
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-forward" title="Forward" disabled><i class="fas fa-arrow-right"></i></button>
                            <button type="button" class="btn-secondary toolbar-input-segment explorer-recent-pages-btn cpl-recent" title="Recent Pages" aria-label="Recent Pages" disabled></button>
                        </div>
                        <div class="button-group cpl-address-group isx-address-group">
                            <div class="form-control colored toolbar-input-segment cpl-address isx-address" role="navigation" aria-label="Address"><span class="isx-progress" aria-hidden="true"></span><i class="fas fa-search cpl-address-icon" aria-hidden="true"></i><span class="isx-crumbs"></span></div>
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-refresh" title="Refresh"><i class="fas fa-sync"></i></button>
                        </div>
                        <div class="button-group">
                            <input type="text" class="form-control colored toolbar-input-segment cpl-search isx-search" placeholder="Search" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" title="Type a tag or phrase (term1 | term2 for either), then press Enter">
                        </div>
                    </div>
                </div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small isx-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content isx-client">
                    <div class="isx-band" role="toolbar" aria-label="Show only">
                        <span class="isx-band-label">Show only:</span>
                        ${VIEW_TYPES.map((v) => `<button type="button" class="isx-band-btn" data-view-type="${v.value}">${esc(v.label)}</button>`).join('')}
                        <button type="button" class="isx-band-btn isx-advanced-toggle" aria-expanded="false">Advanced Search<span class="isx-chevron" aria-hidden="true"></span></button>
                    </div>
                    <div class="isx-advanced win7" hidden>${this.advancedHtml()}</div>
                    <div class="isx-terms" hidden>
                        <span class="isx-band-label">Search for:</span>
                        <span class="isx-term-list"></span>
                    </div>
                    <div class="isx-commandbar" role="toolbar">
                        <button type="button" class="isx-cmd isx-cmd-organize has-menu" title="Organize this search."><img class="isx-cmd-icon" src="${EX}/organize.png" srcset="${EX}/organize.png 1x, ${EX}/organize@2x.png 2x" alt="">Organize<span class="isx-cmd-glyph" aria-hidden="true"></span></button>
                        <button type="button" class="isx-cmd isx-cmd-views has-menu" title="Change your view."><img class="isx-cmd-icon isx-views-icon" src="${EX}/views-icons-lg.png" alt="">Views<span class="isx-cmd-glyph" aria-hidden="true"></span></button>
                        <button type="button" class="isx-cmd isx-cmd-save" title="Save this search."><img class="isx-cmd-icon" src="${CMD}/save.png" alt="">Save Search</button>
                        <button type="button" class="isx-cmd isx-cmd-tools has-menu" title="Search options and tools."><img class="isx-cmd-icon" src="${CMD}/search-tools.png" srcset="${CMD}/search-tools.png 1x, ${CMD}/search-tools@2x.png 2x" alt="">Search Tools<span class="isx-cmd-glyph" aria-hidden="true"></span></button>
                        <button type="button" class="isx-cmd isx-cmd-usages" title="Show where the search terms are used in the prompts." aria-pressed="false"><img class="isx-cmd-icon" src="${CMD}/checklist.png" alt="">Prompt Usages</button>
                        <button type="button" class="isx-cmd isx-cmd-preview has-menu" title="Preview the selected picture." hidden><img class="isx-cmd-icon" src="${CMD}/photo-gallery.png" alt="">Preview<span class="isx-cmd-glyph" aria-hidden="true"></span></button>
                        <button type="button" class="isx-cmd isx-cmd-download" title="Download the selected picture." hidden><img class="isx-cmd-icon" src="${CMD}/download.png" alt="">Download</button>
                        <button type="button" class="isx-cmd isx-cmd-frame" hidden><img class="isx-cmd-icon" src="${CMD}/presentation.png" alt=""><span class="isx-frame-label">Show in photo frame</span></button>
                        <button type="button" class="isx-help" title="Get help"><img src="${EX}/help-16.png" srcset="${EX}/help-16.png 1x, ${EX}/help-16@2x.png 2x" alt=""></button>
                    </div>
                    <div class="isx-main">
                        <aside class="isx-nav" aria-label="Navigation pane">
                            <div class="isx-favorites">
                                <div class="isx-nav-heading">Favorite Links</div>
                                <ul class="isx-favorite-links"></ul>
                            </div>
                            <div class="isx-folders is-open">
                                <button type="button" class="isx-folders-bar" aria-expanded="true"><span>Folders</span><span class="isx-folders-chevron" aria-hidden="true"></span></button>
                                <div class="isx-folders-tree"><ul class="isx-tree" role="tree" tabindex="0"></ul></div>
                            </div>
                        </aside>
                        <div class="isx-view">
                            <div class="isx-columns" role="row"></div>
                            <div class="isx-results" tabindex="0" role="listbox" aria-label="Search results"></div>
                            <div class="isx-landing">
                                <div class="isx-landing-title">To begin, type in the search box</div>
                                <div class="isx-landing-rule"></div>
                                <div class="isx-landing-text">Type a tag or phrase and press Enter; term1 | term2 finds either. To narrow the search, use Advanced Search.</div>
                                <button type="button" class="isx-link isx-restore" hidden></button>
                            </div>
                        </div>
                    </div>
                    <div class="isx-details" aria-live="polite">
                        <div class="isx-details-icon"></div>
                        <div class="isx-details-info"></div>
                    </div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.$ = (q) => m.querySelector(q);
            this.wire();
            this.syncPanes();
        }

        advancedHtml() {
            const opt = (list, labelAny) => `${labelAny ? `<option value="">${esc(labelAny)}</option>` : ''}${list.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}`;
            const tri = '<option value="">Any</option><option value="1">Yes</option><option value="0">No</option>';
            return `
                <div class="isx-adv-grid">
                    <div class="isx-adv-col">
                        <label class="isx-adv-row"><span class="isx-adv-label">Location</span><select class="isx-f-location isx-wide"></select></label>
                        <div class="isx-adv-row isx-adv-note"><span class="isx-adv-label"></span><span class="isx-corpus">0 pictures in this location</span></div>
                        <label class="isx-adv-row"><span class="isx-adv-label">Date</span><select class="isx-f-datemode isx-wide"><option value="relative">Any time, or within</option><option value="exact">Between two dates</option></select></label>
                        <div class="isx-date-relative">
                            <label class="isx-adv-row"><span class="isx-adv-label">After</span><select class="isx-f-after isx-wide" title="Created after">${opt(RELATIVE_DATES, 'any')}</select></label>
                            <label class="isx-adv-row"><span class="isx-adv-label">Before</span><select class="isx-f-before isx-wide" title="Created before">${opt(RELATIVE_DATES, 'any')}</select></label>
                        </div>
                        <div class="isx-date-exact" hidden>
                            <label class="isx-adv-row"><span class="isx-adv-label">From</span><input type="date" class="isx-f-from isx-wide"></label>
                            <label class="isx-adv-row"><span class="isx-adv-label">To</span><input type="date" class="isx-f-to isx-wide"></label>
                        </div>
                        <label class="isx-adv-row"><span class="isx-adv-label">Upscaled</span><select class="isx-f-upscaled isx-wide">${tri}</select></label>
                        <label class="isx-adv-row"><span class="isx-adv-label">Replacements</span><select class="isx-f-dynRepl isx-wide" title="Dynamic replacements">${tri}</select></label>
                    </div>
                    <div class="isx-adv-col">
                        <div class="isx-adv-row"><span class="isx-adv-label">Model</span><button type="button" class="isx-combo-btn isx-f-models isx-wide">All models</button></div>
                        <div class="isx-adv-row"><span class="isx-adv-label">Resolution</span><button type="button" class="isx-combo-btn isx-f-resolution isx-wide">All resolutions</button></div>
                        <label class="isx-adv-row"><span class="isx-adv-label">Sampler</span><select class="isx-f-sampler isx-wide"></select></label>
                        <label class="isx-adv-row"><span class="isx-adv-label">Scheduler</span><select class="isx-f-scheduler isx-wide" title="Noise scheduler"></select></label>
                        <div class="isx-adv-row"><span class="isx-adv-label">Steps</span><input type="number" class="isx-f-stepsMin isx-num" min="1" max="150" placeholder="any"><span class="isx-to">to</span><input type="number" class="isx-f-stepsMax isx-num" min="1" max="150" placeholder="any"></div>
                        <div class="isx-adv-row"><span class="isx-adv-label">Guidance</span><input type="number" class="isx-f-guidanceMin isx-num" min="0" max="30" step="0.1" placeholder="any"><span class="isx-to">to</span><input type="number" class="isx-f-guidanceMax isx-num" min="0" max="30" step="0.1" placeholder="any"></div>
                        <div class="isx-adv-row"><span class="isx-adv-label">Rescale</span><input type="number" class="isx-f-rescaleMin isx-num" min="0" max="1" step="0.01" placeholder="any"><span class="isx-to">to</span><input type="number" class="isx-f-rescaleMax isx-num" min="0" max="1" step="0.01" placeholder="any"></div>
                    </div>
                    <div class="isx-adv-col">
                        <div class="isx-adv-row"><span class="isx-adv-label">Prompt</span><label class="isx-check"><input type="checkbox" class="isx-f-compiled"> Compiled</label><label class="isx-check"><input type="checkbox" class="isx-f-input"> Input</label></div>
                        <label class="isx-adv-row"><span class="isx-adv-label">Match</span><select class="isx-f-match isx-wide" title="Default match for new terms">${opt(MATCH_MODES)}</select></label>
                        <label class="isx-adv-row"><span class="isx-adv-label">Quality tags</span><select class="isx-f-quality isx-wide">${tri}</select></label>
                        <div class="isx-adv-row"><span class="isx-adv-label">UC preset</span><label class="isx-check"><input type="checkbox" class="isx-f-ucAny"> Any</label><input type="range" class="isx-f-uc isx-track" min="0" max="8" step="1" value="0"><span class="isx-track-value isx-uc-value"></span></div>
                        <div class="isx-adv-row"><span class="isx-adv-label">NSFW level</span><label class="isx-check"><input type="checkbox" class="isx-f-nsfwAny"> Any</label><input type="range" class="isx-f-nsfw isx-track" min="-2" max="3" step="1" value="0"><span class="isx-track-value isx-nsfw-value"></span></div>
                        <div class="isx-adv-row"><span class="isx-adv-label"></span><label class="isx-check" title="The same seed within 24 hours"><input type="checkbox" class="isx-f-seeds"> Consecutive seeds only</label></div>
                        <div class="isx-adv-row isx-adv-buttons"><button type="button" class="btn-standard isx-adv-clear">Clear</button><button type="button" class="btn-standard isx-adv-search">Search</button></div>
                    </div>
                </div>`;
        }

        wire() {
            const m = this.modal;
            m.querySelector('.isx-close').addEventListener('click', () => this.close());
            this.$('.cpl-back').addEventListener('click', () => this.go(-1));
            this.$('.cpl-forward').addEventListener('click', () => this.go(1));
            this.$('.cpl-refresh').addEventListener('click', () => this.refresh());
            const box = this.$('.isx-search');
            box.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                this.submitSearchBox();
            });
            this.$('.isx-band').addEventListener('click', (ev) => {
                const b = ev.target.closest('.isx-band-btn');
                if (!b) return;
                if (b.classList.contains('isx-advanced-toggle')) { this.setPane('advanced', !this.panes.advanced); return; }
                this.setViewType(b.dataset.viewType);
            });
            const adv = this.$('.isx-advanced');
            adv.addEventListener('click', (ev) => {
                if (ev.target.closest('.isx-adv-search')) { this.applyAdvanced(); return; }
                if (ev.target.closest('.isx-adv-clear')) { this.clearFilters(); }
            });
            adv.addEventListener('change', (ev) => this.onAdvancedChange(ev));
            adv.addEventListener('input', (ev) => {
                if (ev.target.matches('.isx-f-uc, .isx-f-nsfw')) this.onAdvancedChange(ev);
            });
            adv.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && ev.target.matches('input')) { ev.preventDefault(); this.applyAdvanced(); }
            });
            this.$('.isx-term-list').addEventListener('click', (ev) => {
                const x = ev.target.closest('.isx-term-remove');
                if (x) { ev.stopPropagation(); this.removeBlock(Number(x.dataset.index)); }
            });
            this.$('.isx-cmd-save').addEventListener('click', () => void this.saveSearch());
            this.$('.isx-cmd-usages').addEventListener('click', () => this.setView(this.state.view === 'usages' ? 'gallery' : 'usages'));
            this.$('.isx-cmd-download').addEventListener('click', () => this.action('download'));
            this.$('.isx-cmd-frame').addEventListener('click', () => this.saveToPhotoFrame());
            this.$('.isx-help').addEventListener('click', () => call('openHelpAndSupport', 'search'));
            this.$('.isx-restore').addEventListener('click', () => this.restoreLastSearch());
            this.$('.isx-folders-bar').addEventListener('click', () => {
                const f = this.$('.isx-folders');
                f.classList.toggle('is-open');
                this.$('.isx-folders-bar').setAttribute('aria-expanded', String(f.classList.contains('is-open')));
            });
            this.$('.isx-favorite-links').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-link]');
                if (b) this.openLink(b.dataset.link, b.dataset.value);
            });
            this.$('.isx-tree').addEventListener('click', (ev) => {
                const row = ev.target.closest('.isx-tree-row');
                if (!row) return;
                const node = row.parentElement;
                if (ev.target.closest('.isx-tree-glyph') && node.classList.contains('has-children')) { node.classList.toggle('is-open'); return; }
                if (node.dataset.ws) this.setWorkspace(node.dataset.ws, true);
            });
            const results = this.$('.isx-results');
            results.addEventListener('click', (ev) => this.onResultsClick(ev));
            results.addEventListener('dblclick', (ev) => {
                const item = ev.target.closest('.isx-item');
                if (item) this.openProperties(item.dataset.filename);
            });
            results.addEventListener('keydown', (ev) => this.onResultsKey(ev));
            results.addEventListener('mousedown', (ev) => {
                if (ev.button !== 2) return;
                const item = ev.target.closest('.isx-item');
                if (item) this.select(item.dataset.filename);
            });
            this.$('.isx-columns').addEventListener('click', (ev) => {
                const c = ev.target.closest('[data-sort]');
                if (!c) return;
                const field = c.dataset.sort;
                this.sort = { field, dir: this.sort.field === field && this.sort.dir === 'asc' ? 'desc' : 'asc' };
                this.renderResults();
            });
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'F5') { ev.preventDefault(); this.refresh(); }
                else if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); this.go(-1); }
                else if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); this.go(1); }
                else if ((ev.ctrlKey && ev.key.toLowerCase() === 'e') || ev.key === 'F3') { ev.preventDefault(); this.$('.isx-search').focus(); }
            });
            this.wireMenus();
        }

        // contextMenu: public/scripts/comp/contextMenu.js (the Vista menus on the desktop)
        wireMenus() {
            const cm = root.contextMenu;
            if (!cm) return;
            const click = (el, items, onAction) => cm.attachClickMenuToElement(el, {
                position: 'anchor',
                anchorAlign: 'start',
                maxHeight: 460,
                sections: [{ type: 'list', initfn: (s) => { s.items = items(); } }],
                onAction: (a, target, item) => onAction(a, item, target)
            });
            click(this.$('.isx-cmd-organize'), () => this.organizeItems(), (a) => this.action(a));
            this.$('.isx-cmd-views').addEventListener('click', (ev) => { ev.stopPropagation(); viewsMenu.toggle(this); });
            click(this.$('.isx-cmd-tools'), () => this.toolsItems(), (a) => this.action(a));
            click(this.$('.isx-cmd-preview'), () => [
                { text: 'Open in Window', action: 'window' },
                { text: 'Edit in Paint', action: 'paint' },
                { text: 'Open in Studio', action: 'studio' }
            ], (a) => this.action(a));
            click(this.$('.cpl-recent'), () => this.recentItems(), (a) => this.action(a));
            click(this.$('.isx-f-models'), () => this.modelItems(), (a, item) => this.toggleListFilter('models', item && item.value));
            click(this.$('.isx-f-resolution'), () => RESOLUTION_TIERS.map((r) => ({
                text: r.label, action: 'toggle', value: r.value, keepMenuOpen: true, showIndicator: true,
                checked: (this.state.filters.resolutionPreset || []).includes(r.value)
            })), (a, item) => this.toggleListFilter('resolutionPreset', item && item.value));
            // a search term: its match mode, or Remove (attached to each term as renderTerms draws it)
            this.termMenu = {
                position: 'anchor',
                anchorAlign: 'start',
                sections: [{ type: 'list', initfn: (s, target) => { s.items = this.termItems(target); } }],
                onAction: (a, target) => this.termAction(a, target)
            };
            // right-click on the results: the picture's commands, or the view's
            cm.attachToElement(this.$('.isx-results'), {
                sections: [{ type: 'list', initfn: (s) => { s.items = this.resultMenuItems(); } }],
                onAction: (a, target, item) => this.action(a, item)
            });
        }

        organizeItems() {
            const sel = !!this.state.selected;
            return [
                { text: 'Layout', submenu: [
                    { text: 'Search Pane', action: 'pane:advanced', checked: this.panes.advanced, showIndicator: true },
                    { text: 'Details Pane', action: 'pane:details', checked: this.panes.details, showIndicator: true },
                    { text: 'Navigation Pane', action: 'pane:nav', checked: this.panes.nav, showIndicator: true }
                ] },
                { separator: true },
                { text: 'Copy Snippet', action: 'copy-snippet', disabled: this.state.view !== 'usages' || !this.selectedUsage() },
                { text: 'Copy Full Prompt', action: 'copy-prompt', disabled: this.state.view !== 'usages' || !this.selectedUsage() },
                { separator: true },
                { text: 'Properties', action: 'properties', disabled: !sel },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
        }

        toolsItems() {
            const last = root.omegasearchDsapLastActiveSearch || (typeof omegasearchDsapLastActiveSearch !== 'undefined' ? omegasearchDsapLastActiveSearch : null);
            return [
                { text: 'Search Pane', action: 'pane:advanced', checked: this.panes.advanced, showIndicator: true },
                { separator: true },
                { text: 'Clear Search Filters', action: 'clear-filters' },
                { text: 'Return to Last Search', action: 'restore', disabled: !last },
                { text: 'Search Again', action: 'refresh', disabled: !this.state.blocks.length }
            ];
        }

        recentItems() {
            const items = [];
            const cur = this.currentUrl();
            this.history.slice(-8).forEach((u, i, arr) => items.push({ text: this.labelFor(u), action: `hist:${this.history.length - arr.length + i}` }));
            items.push({ text: this.labelFor(cur), action: 'noop', checked: true, showIndicator: true, indicatorMark: 'radio' });
            this.future.slice(-8).reverse().forEach((u, i) => items.push({ text: this.labelFor(u), action: `fut:${this.future.length - 1 - i}` }));
            return items.reverse();
        }

        modelItems() {
            const selected = new Set(this.state.filters.models || []);
            const items = [];
            let group = null;
            // omegasearchDsapGetModelOptions: public/scripts/comp/omegasearchDsapApplet.js
            omegasearchDsapGetModelOptions().forEach((o) => {
                if (o.group && o.group !== group) { items.push({ separator: true, text: o.group }); group = o.group; }
                items.push({ text: o.label, action: 'toggle', value: o.value, keepMenuOpen: true, showIndicator: true, checked: selected.has(o.value) });
            });
            return items.length ? items : [{ text: 'No models available', disabled: true }];
        }

        termItems(target) {
            const i = Number(target && target.dataset ? target.dataset.index : NaN);
            const block = this.state.blocks[i];
            if (!block) return [];
            const cur = block.matchMode || 'substring';
            return MATCH_MODES.map((mm) => ({ text: mm.label, action: `match:${mm.value}`, checked: cur === mm.value, showIndicator: true, indicatorMark: 'radio' }))
                .concat([{ separator: true }, { text: 'Remove', action: 'remove' }]);
        }

        termAction(a, target) {
            const i = Number(target && target.dataset ? target.dataset.index : NaN);
            if (!Number.isFinite(i) || !this.state.blocks[i]) return;
            if (a === 'remove') { this.removeBlock(i); return; }
            if (String(a).startsWith('match:')) {
                this.state.blocks[i] = { ...this.state.blocks[i], matchMode: a.slice(6) };
                this.searchNow(true);
            }
        }

        resultMenuItems() {
            const s = this.state;
            if (s.view === 'usages') {
                const u = this.selectedUsage();
                return [
                    { text: 'Copy Snippet', action: 'copy-snippet', disabled: !u },
                    { text: 'Copy Full Prompt', action: 'copy-prompt', disabled: !u },
                    { separator: true },
                    { text: 'Refresh', action: 'refresh' }
                ];
            }
            if (!s.selected) {
                return [
                    { text: 'View', submenu: VIEW_MODES.map((v) => ({ text: v.label, action: `view:${v.id}`, checked: this.viewMode === v.id, showIndicator: true, indicatorMark: 'radio' })) },
                    { separator: true },
                    { text: 'Refresh', action: 'refresh' }
                ];
            }
            const pinned = omegasearchDsapIsDetailImagePinned(s.selected, this.metaCache.get(s.selected));
            return [
                { text: 'Open', action: 'properties', bold: true },
                { text: 'Open in Window', action: 'window' },
                { text: 'Edit in Paint', action: 'paint' },
                { text: 'Open in Studio', action: 'studio' },
                { separator: true },
                { text: 'Jump to Image', action: 'jump' },
                { text: 'Go to Workspace', action: 'workspace' },
                { text: pinned ? 'Remove from Favorites' : 'Add to Favorites', action: 'favorite' },
                { separator: true },
                { text: 'Download', action: 'download' },
                { separator: true },
                { text: 'Properties', action: 'properties' }
            ];
        }

        // ---- commands --------------------------------------------------------------------------------

        action(a, item) {
            const s = this.state;
            if (!a || a === 'noop') return;
            if (a.startsWith('view:')) { this.setViewMode(a.slice(5)); return; }
            if (a.startsWith('pane:')) { const p = a.slice(5); this.setPane(p, !this.panes[p]); return; }
            if (a.startsWith('hist:')) { this.go(Number(a.slice(5)) - this.history.length); return; }
            if (a.startsWith('fut:')) { this.go(this.future.length - Number(a.slice(4))); return; }
            const file = (item && item.data && item.data.filename) || s.selected;
            switch (a) {
                case 'close': this.close(); break;
                case 'refresh': this.refresh(); break;
                case 'clear-filters': this.clearFilters(); break;
                case 'restore': this.restoreLastSearch(); break;
                case 'properties': if (file) this.openProperties(file); break;
                case 'copy-snippet': void this.copyUsage(false); break;
                case 'copy-prompt': void this.copyUsage(true); break;
                default: if (file) void imageAction(a, file, this.metaCache.get(file), () => this.renderDetails());
            }
        }

        submitSearchBox() {
            const box = this.$('.isx-search');
            const text = box.value.trim();
            if (text) {
                // omegasearchDsapParseBlockInput: "a | b" is one block that matches either
                const block = omegasearchDsapParseBlockInput(text);
                if (block) {
                    block.matchMode = this.state.blockOptions.defaultMatchMode || 'substring';
                    this.state.blocks = omegasearchDsapNormalizeBlocks(this.state.blocks.concat([block]), { defaultMatchMode: block.matchMode });
                }
                box.value = '';
            }
            if (!this.state.blocks.length) {
                toast('info', 'Type a tag or phrase in the search box, then press Enter.');
                return;
            }
            this.searchNow(true);
        }

        removeBlock(i) {
            const blocks = this.state.blocks.slice();
            if (i < 0 || i >= blocks.length) return;
            blocks.splice(i, 1);
            this.state.blocks = blocks;
            this.state.searchSessionId = null;
            this.state.serverSearchSessionId = null;
            if (blocks.length) {
                this.searchNow(true);
                return;
            }
            Object.assign(this.state, { view: 'search', results: [], usages: [], total: 0, searched: false, selected: null, page: 1 });
            this.pushHistory();
            this.render();
        }

        setViewType(value) {
            if (!VIEW_TYPES.some((v) => v.value === value) || this.state.viewType === value) return;
            this.state.viewType = value;
            this.state.page = 1;
            if (this.state.blocks.length && this.state.searched) this.searchNow(false);
            else { this.pushHistory(); this.render(); }
        }

        setWorkspace(id, run) {
            this.state.workspaceId = id || GLOBAL_WS;
            this.state.page = 1;
            const loc = this.$('.isx-f-location');
            if (loc) loc.value = this.state.workspaceId;
            if (run && this.state.blocks.length && this.state.searched) this.searchNow(false);
            else { this.pushHistory(); this.render(); }
        }

        setView(view) {
            this.state.view = view;
            if (view === 'usages') this.state.selected = null;
            this.pushHistory();
            this.render();
        }

        setViewMode(id) {
            if (!VIEW_MODES.some((v) => v.id === id)) return;
            this.viewMode = id;
            setReg({ ViewMode: id });
            if (this.state.view === 'usages') this.state.view = 'gallery';
            this.render();
        }

        setPane(name, on) {
            this.panes[name] = !!on;
            if (name === 'nav') setReg({ NavigationPane: !!on });
            if (name === 'details') setReg({ DetailsPane: !!on });
            this.syncPanes();
        }

        syncPanes() {
            const m = this.modal;
            m.classList.toggle('isx-no-nav', !this.panes.nav);
            m.classList.toggle('isx-no-details', !this.panes.details);
            const adv = this.$('.isx-advanced');
            adv.hidden = !this.panes.advanced;
            const t = this.$('.isx-advanced-toggle');
            t.setAttribute('aria-expanded', String(this.panes.advanced));
            t.classList.toggle('is-open', this.panes.advanced);
            if (this.panes.advanced) this.syncAdvanced();
        }

        refresh() {
            if (!this.state.blocks.length) { this.render(); return; }
            this.state.searchSessionId = null;
            this.state.serverSearchSessionId = null;
            this.searchNow(true, true);
        }

        clearFilters() {
            const s = this.state;
            s.filters = omegasearchDsapDefaultFilters();
            s.promptSourceCompiled = true;
            s.promptSourceInput = true;
            s.blockOptions = omegasearchDsapDefaultBlockOptions();
            this.syncAdvanced();
            this.renderAdvancedLabels();
        }

        /** The Search button: the pane's fields become the search. */
        applyAdvanced() {
            this.readAdvanced();
            const box = this.$('.isx-search');
            if (box.value.trim()) { this.submitSearchBox(); return; }
            if (!this.state.blocks.length) {
                toast('info', 'Type a tag or phrase in the search box, then press Enter.');
                return;
            }
            this.searchNow(true);
        }

        // ---- Advanced Search pane ----------------------------------------------------------------

        syncAdvanced() {
            const s = this.state;
            const f = s.filters || omegasearchDsapDefaultFilters();
            const q = (c) => this.$(`.isx-f-${c}`);
            const loc = q('location');
            const list = [{ value: GLOBAL_WS, label: 'All Workspaces' }];
            const cur = activeWs();
            omegasearchDsapGetWorkspaceList().forEach((w) => list.push({ value: w.id, label: w.id === cur ? `${w.name} (this workspace)` : w.name }));
            if (s.workspaceId !== GLOBAL_WS && !list.some((o) => o.value === s.workspaceId)) list.push({ value: s.workspaceId, label: s.workspaceId });
            loc.innerHTML = list.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
            loc.value = s.workspaceId;
            const fill = (sel, any, opts, value) => {
                sel.innerHTML = `<option value="">${esc(any)}</option>${opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}`;
                sel.value = value || '';
            };
            // omegasearchDsapGetSamplerOptions / SchedulerOptions: public/scripts/comp/omegasearchDsapApplet.js
            fill(q('sampler'), 'Any sampler', omegasearchDsapGetSamplerOptions(), f.sampler);
            fill(q('scheduler'), 'Any scheduler', omegasearchDsapGetSchedulerOptions(), f.scheduler);
            q('datemode').value = f.dateMode === 'exact' ? 'exact' : 'relative';
            q('after').value = (f.dateAfter && f.dateAfter.relative) || '';
            q('before').value = (f.dateBefore && f.dateBefore.relative) || '';
            q('from').value = f.dateRange && f.dateRange.start ? String(f.dateRange.start).slice(0, 10) : '';
            q('to').value = f.dateRange && f.dateRange.end ? String(f.dateRange.end).slice(0, 10) : '';
            ['stepsMin', 'stepsMax', 'guidanceMin', 'guidanceMax', 'rescaleMin', 'rescaleMax'].forEach((k) => { q(k).value = f[k] != null ? String(f[k]) : ''; });
            q('compiled').checked = s.promptSourceCompiled !== false;
            q('input').checked = s.promptSourceInput !== false;
            q('match').value = s.blockOptions.defaultMatchMode || 'substring';
            const triVal = (v) => (v === true ? '1' : v === false ? '0' : '');
            q('quality').value = triVal(f.qualityPreset);
            q('upscaled').value = triVal(f.isUpscaled);
            q('dynRepl').value = triVal(f.hasDynamicReplacements);
            q('seeds').checked = !!f.consecutiveSeeds;
            q('ucAny').checked = f.ucLevel == null;
            q('uc').value = String(f.ucLevel != null ? f.ucLevel : 0);
            q('nsfwAny').checked = f.nsfwLevel == null;
            q('nsfw').value = String(f.nsfwLevel != null ? f.nsfwLevel : 0);
            this.renderAdvancedLabels();
        }

        renderAdvancedLabels() {
            const s = this.state;
            const f = s.filters;
            const q = (c) => this.$(`.isx-f-${c}`);
            const exact = q('datemode').value === 'exact';
            this.$('.isx-date-relative').hidden = exact;
            this.$('.isx-date-exact').hidden = !exact;
            const n = (f.models || []).length;
            q('models').textContent = n ? (n === 1 ? (omegasearchDsapGetModelOptions().find((o) => o.value === f.models[0]) || {}).label || f.models[0] : `${n} models`) : 'All models';
            const tiers = f.resolutionPreset || [];
            q('resolution').textContent = tiers.length ? tiers.map((t) => (RESOLUTION_TIERS.find((r) => r.value === t) || {}).label || t).join(', ') : 'All resolutions';
            const ucAny = q('ucAny').checked;
            const nsfwAny = q('nsfwAny').checked;
            q('uc').disabled = ucAny;
            q('nsfw').disabled = nsfwAny;
            // omegasearchDsapUcLevelLabel: public/scripts/comp/omegasearchDsapApplet.js (UC_PRESET_LEVEL_LABELS)
            this.$('.isx-uc-value').textContent = ucAny ? '' : omegasearchDsapUcLevelLabel(Number(q('uc').value));
            this.$('.isx-nsfw-value').textContent = nsfwAny ? '' : (NSFW_LABELS[Number(q('nsfw').value)] || q('nsfw').value);
            const corpus = s.corpusSize != null && s.searched ? s.corpusSize : omegasearchDsapEstimateCorpusSize(q('location').value || GLOBAL_WS, s.viewType);
            this.$('.isx-corpus').textContent = `${num(corpus)} ${corpus === 1 ? 'picture' : 'pictures'} in this location`;
        }

        onAdvancedChange(ev) {
            const t = ev.target;
            if (t.matches('.isx-f-compiled, .isx-f-input') && !this.$('.isx-f-compiled').checked && !this.$('.isx-f-input').checked) {
                // one prompt source at least, as the DSAP's toggles had it
                (t.matches('.isx-f-compiled') ? this.$('.isx-f-input') : this.$('.isx-f-compiled')).checked = true;
            }
            if (t.matches('.isx-f-uc')) this.$('.isx-f-ucAny').checked = false;
            if (t.matches('.isx-f-nsfw')) this.$('.isx-f-nsfwAny').checked = false;
            if (t.matches('.isx-f-location')) this.state.corpusSize = null;
            this.renderAdvancedLabels();
        }

        toggleListFilter(key, value) {
            if (!value) return;
            const set = new Set(this.state.filters[key] || []);
            if (set.has(value)) set.delete(value); else set.add(value);
            this.state.filters[key] = [...set];
            this.renderAdvancedLabels();
        }

        /** The pane's controls into the state (the DSAP's _collectFiltersFromInputs). */
        readAdvanced() {
            const s = this.state;
            const q = (c) => this.$(`.isx-f-${c}`);
            const f = { ...omegasearchDsapDefaultFilters(), models: s.filters.models || [], resolutionPreset: s.filters.resolutionPreset || [] };
            f.dateMode = q('datemode').value === 'exact' ? 'exact' : 'relative';
            if (f.dateMode === 'exact') {
                const a = q('from').value.trim();
                const b = q('to').value.trim();
                f.dateRange = a || b ? { start: a || undefined, end: b || undefined } : null;
            } else {
                f.dateAfter = q('after').value ? { relative: q('after').value } : null;
                f.dateBefore = q('before').value ? { relative: q('before').value } : null;
            }
            // omegasearchDsapParseOptionalInt / Float: public/scripts/comp/omegasearchDsapApplet.js
            f.stepsMin = omegasearchDsapParseOptionalInt(q('stepsMin').value);
            f.stepsMax = omegasearchDsapParseOptionalInt(q('stepsMax').value);
            f.guidanceMin = omegasearchDsapParseOptionalFloat(q('guidanceMin').value);
            f.guidanceMax = omegasearchDsapParseOptionalFloat(q('guidanceMax').value);
            f.rescaleMin = omegasearchDsapParseOptionalFloat(q('rescaleMin').value);
            f.rescaleMax = omegasearchDsapParseOptionalFloat(q('rescaleMax').value);
            f.sampler = q('sampler').value || null;
            f.scheduler = q('scheduler').value || null;
            const tri = (v) => (v === '1' ? true : v === '0' ? false : null);
            f.qualityPreset = tri(q('quality').value);
            f.isUpscaled = tri(q('upscaled').value);
            f.hasDynamicReplacements = tri(q('dynRepl').value);
            f.consecutiveSeeds = q('seeds').checked;
            f.ucLevel = q('ucAny').checked ? null : Number(q('uc').value);
            f.nsfwLevel = q('nsfwAny').checked ? null : Number(q('nsfw').value);
            s.filters = f;
            s.promptSourceCompiled = q('compiled').checked;
            s.promptSourceInput = q('input').checked;
            s.blockOptions = { defaultMatchMode: q('match').value || 'substring' };
            s.workspaceId = q('location').value || GLOBAL_WS;
        }

        // ---- URL state ------------------------------------------------------------------------------

        promptSource() {
            const c = this.state.promptSourceCompiled !== false;
            const i = this.state.promptSourceInput !== false;
            if (c && i) return null;
            return c ? 'compiled' : (i ? 'input' : null);
        }

        currentUrl() {
            const s = this.state;
            // omegasearchDsapBuildUrl: public/scripts/comp/omegasearchDsapApplet.js (the DSAP's own URL form)
            return omegasearchDsapBuildUrl({
                blocks: s.blocks,
                view: s.view,
                viewType: s.viewType,
                workspaceId: s.workspaceId,
                file: s.detailFile || null,
                page: s.page,
                filters: s.filters,
                promptSource: this.promptSource(),
                blockOptions: s.blockOptions,
                frame: s.frameId
            });
        }

        labelFor(url) {
            const h = hostFor(url);
            const blocks = omegasearchDsapResolveBlocks(h);
            const where = workspaceLabel(omegasearchDsapResolveWorkspaceId(h));
            return blocks.length ? `${blocks.map(omegasearchDsapFormatBlockLabel).join(', ')} - ${where}` : `Search Results in ${where}`;
        }

        /** A DSAP URL (or its query) into the state, as the DSAP's init read its host. */
        applyUrl(url) {
            const h = hostFor(url);
            const s = this.state;
            const filters = omegasearchDsapResolveFilters(h);
            const promptSource = filters.promptSource || null;
            delete filters.promptSource;
            s.blocks = omegasearchDsapResolveBlocks(h);
            s.blockOptions = omegasearchDsapResolveBlockOptions(h);
            s.filters = filters;
            s.promptSourceCompiled = promptSource !== 'input';
            s.promptSourceInput = promptSource !== 'compiled';
            s.viewType = omegasearchDsapResolveViewType(h);
            s.workspaceId = omegasearchDsapResolveWorkspaceId(h);
            s.page = omegasearchDsapResolvePage(h);
            let view = omegasearchDsapResolveView(h);
            const file = omegasearchDsapResolveDetailFile(h);
            s.detailFile = view === 'detail' ? file : null;
            if (view === 'detail') view = 'gallery';
            if (view === 'gallery' && !s.blocks.length) view = 'search';
            s.view = view;
            const frame = h.getQueryParam('frame');
            if (frame) s.frameId = frame;
            s.selected = s.detailFile || null;
            s.results = [];
            s.usages = [];
            s.total = 0;
            s.searched = false;
            s.searchSessionId = null;
            s.serverSearchSessionId = null;
            if (this.panes.advanced) this.syncAdvanced();
        }

        pushHistory() {
            const url = this.currentUrl();
            if (this.lastUrl && this.lastUrl !== url) {
                this.history.push(this.lastUrl);
                if (this.history.length > 50) this.history.shift();
                this.future = [];
            }
            this.lastUrl = url;
        }

        go(delta) {
            if (!delta) return;
            let url = null;
            if (delta < 0) {
                for (let i = 0; i < -delta && this.history.length; i += 1) {
                    this.future.push(this.lastUrl);
                    this.lastUrl = this.history.pop();
                }
                url = this.lastUrl;
            } else {
                for (let i = 0; i < delta && this.future.length; i += 1) {
                    this.history.push(this.lastUrl);
                    this.lastUrl = this.future.pop();
                }
                url = this.lastUrl;
            }
            if (!url) return;
            const frame = this.state.frameId;
            this.applyUrl(url);
            this.state.frameId = frame;
            this.startFromState(false);
        }

        /** After applyUrl: run (or restore) the search the URL names and show its picture. */
        startFromState(record) {
            const s = this.state;
            if (record) this.pushHistory();
            if (s.blocks.length && s.view !== 'search') {
                this.runSearch(false);
            } else {
                this.render();
            }
            if (s.detailFile) {
                // omegasearchDsapNormalizeMetadataFilename: public/scripts/comp/omegasearchDsapApplet.js
                const file = omegasearchDsapNormalizeMetadataFilename(s.detailFile);
                s.detailFile = null;
                s.selected = file;
                this.renderDetails();
                this.openProperties(file);
            }
        }

        // ---- searching (the DSAP's _runSearch, with its sessions) -----------------------------------

        cacheKey() {
            const s = this.state;
            // omegasearchDsapBuildSearchCacheKey / BuildFiltersPayload: public/scripts/comp/omegasearchDsapApplet.js
            return omegasearchDsapBuildSearchCacheKey(s.blocks, omegasearchDsapBuildFiltersPayload(s.filters), s.workspaceId, s.viewType, this.promptSource(), s.blockOptions);
        }

        /** A new search from the controls: page 1, the results view, the URL recorded. */
        searchNow(force, keepPage) {
            const s = this.state;
            if (this.panes.advanced) this.readAdvanced();
            if (!keepPage) s.page = 1;
            if (s.view === 'search') s.view = 'gallery';
            s.selected = null;
            this.pushHistory();
            this.runSearch(force);
        }

        findSession(key) {
            // omegasearchDsapSearchSessions: the DSAP's session cache (sessionStorage ispy-dsap-search-sessions-v1)
            for (const session of omegasearchDsapSearchSessions.values()) if (session.queryKey === key) return session;
            return null;
        }

        ensureSession(force) {
            const s = this.state;
            const key = this.cacheKey();
            let session = s.searchSessionId ? omegasearchDsapSearchSessions.get(s.searchSessionId) : null;
            if (!session || session.queryKey !== key) session = this.findSession(key);
            if (!session) {
                const id = `ispy-${omegasearchDsapNextSessionSerial++}-${Date.now().toString(36)}`;
                session = { id, queryKey: key, total: 0, usages: [], pages: {}, corpusSize: null, lastPage: 1, pageSize: PAGE_SIZE, serverSessionId: null };
                omegasearchDsapSearchSessions.set(id, session);
            }
            if (force) {
                session.pages = {};
                session.serverSessionId = null;
            }
            s.searchSessionId = session.id;
            s.serverSearchSessionId = session.serverSessionId || null;
            omegasearchDsapPersistSessionsToStorage();
            return session;
        }

        applySessionPage(session) {
            const s = this.state;
            const page = session && session.pages[s.page];
            if (!page) return false;
            s.results = page;
            s.total = session.total;
            s.usages = session.usages || [];
            s.corpusSize = session.corpusSize;
            s.searched = true;
            session.lastPage = s.page;
            this.setLoading(false);
            this.render();
            return true;
        }

        async runSearch(force) {
            const s = this.state;
            if (!s.blocks.length) {
                Object.assign(s, { results: [], usages: [], total: 0, searched: false });
                this.render();
                return;
            }
            const session = this.ensureSession(force);
            if (!force && this.applySessionPage(session)) {
                this.saveSnapshot();
                return;
            }
            const client = ws();
            if (!client || !client.isConnected()) {
                toast('error', 'The server is not connected.');
                this.render();
                return;
            }
            const generation = ++omegasearchDsapNextSearchGeneration;
            const key = session.queryKey;
            const page = s.page;
            const payload = {
                // omegasearchDsapBlocksForSearchPayload: public/scripts/comp/omegasearchDsapApplet.js
                blocks: omegasearchDsapBlocksForSearchPayload(s.blocks, s.blockOptions),
                workspaceId: s.workspaceId,
                viewType: s.viewType,
                offset: (page - 1) * PAGE_SIZE,
                limit: PAGE_SIZE,
                blockOptions: { defaultMatchMode: s.blockOptions.defaultMatchMode || 'substring' }
            };
            const ps = this.promptSource();
            if (ps) payload.promptSource = ps;
            const filters = omegasearchDsapBuildFiltersPayload(s.filters);
            if (Object.keys(filters).length) payload.filters = filters;
            if (force) payload.forceRefresh = true;
            else if (s.serverSearchSessionId) payload.searchSessionId = s.serverSearchSessionId;
            this.setLoading(true);
            this.render();
            const stale = () => generation !== omegasearchDsapNextSearchGeneration || key !== this.cacheKey() || page !== this.state.page;
            try {
                const data = await client.sendMessage('omegasearch_query', payload, false);
                if (stale()) return;
                s.total = (data && data.total) || 0;
                s.results = (data && data.results) || [];
                s.usages = (data && data.usages) || [];
                s.searched = true;
                if (data && data.workspaceId) s.workspaceId = data.workspaceId;
                if (data && data.corpusSize != null) s.corpusSize = data.corpusSize;
                if (data && data.searchSessionId) s.serverSearchSessionId = data.searchSessionId;
                session.total = s.total;
                session.usages = s.usages;
                session.pages[page] = s.results;
                session.lastPage = page;
                if (data && data.corpusSize != null) session.corpusSize = data.corpusSize;
                if (data && data.searchSessionId) session.serverSessionId = data.searchSessionId;
                omegasearchDsapPersistSessionsToStorage();
                this.saveSnapshot();
            } catch (err) {
                if (stale()) return;
                console.error('[image-search] search failed:', err);
                s.searched = true;
                s.results = [];
                s.total = 0;
                s.failed = (err && err.message) || 'The search failed.';
            } finally {
                if (!stale()) {
                    this.setLoading(false);
                    this.render();
                    s.failed = null;
                }
            }
        }

        /** The last search, for Return to Last Search (the DSAP's "Return to active search"). */
        saveSnapshot() {
            const s = this.state;
            if (!s.blocks.length) return;
            const snap = {
                url: this.currentUrl(),
                queryKey: this.cacheKey(),
                label: s.blocks.map(omegasearchDsapFormatBlockLabel).join(' \u00b7 ') || 'Last search'
            };
            // omegasearchDsapLastActiveSearch: a top-level let of omegasearchDsapApplet.js, shared with the DSAP
            try { omegasearchDsapLastActiveSearch = snap; } catch (_) { /* not loaded */ }
            omegasearchDsapPersistSessionsToStorage();
        }

        restoreLastSearch() {
            let snap = null;
            try { snap = omegasearchDsapLastActiveSearch; } catch (_) { snap = null; }
            if (!snap || !snap.url) return;
            const frame = this.state.frameId;
            this.applyUrl(snap.url);
            this.state.frameId = frame;
            if (this.state.view === 'search') this.state.view = 'gallery';
            this.startFromState(true);
        }

        setLoading(on) {
            this.state.loading = !!on;
            this.modal.classList.toggle('isx-busy', !!on);
        }

        // ---- rendering --------------------------------------------------------------------------------

        render() {
            const s = this.state;
            const m = this.modal;
            const landing = !s.blocks.length && s.view === 'search';
            m.classList.toggle('is-landing', landing);
            m.classList.toggle('isx-usages', s.view === 'usages');
            this.renderAddress();
            this.$('.isx-window-title').textContent = 'Search Results';
            this.$('.cpl-back').disabled = !this.history.length;
            this.$('.cpl-forward').disabled = !this.future.length;
            this.$('.cpl-recent').disabled = !this.history.length && !this.future.length;
            this.$('.isx-band').querySelectorAll('[data-view-type]').forEach((b) => b.classList.toggle('is-on', b.dataset.viewType === s.viewType));
            this.renderTerms();
            this.renderCommands();
            this.renderNav();
            if (landing) this.renderLanding();
            this.renderResults();
            this.renderDetails();
            if (this.panes.advanced) this.renderAdvancedLabels();
        }

        renderAddress() {
            const s = this.state;
            const parts = [`Search Results in ${workspaceLabel(s.workspaceId)}`];
            if (s.viewType !== 'images') parts.push((VIEW_TYPES.find((v) => v.value === s.viewType) || {}).label);
            if (s.view === 'usages') parts.push('Prompt Usages');
            this.$('.isx-crumbs').innerHTML = parts.map((p) => `<span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span><span class="cpl-crumb isx-crumb">${esc(p)}</span>`).join('');
        }

        renderTerms() {
            const s = this.state;
            const host = this.$('.isx-terms');
            host.hidden = !s.blocks.length;
            const list = this.$('.isx-term-list');
            const cm = root.contextMenu;
            if (cm) list.querySelectorAll('.isx-term').forEach((t) => cm.detachClickMenuFromElement(t));
            list.innerHTML = s.blocks.map((b, i) => {
                const label = omegasearchDsapFormatBlockLabel({ ...b, matchMode: 'substring' });
                const mode = b.matchMode && b.matchMode !== 'substring' ? (MATCH_MODES.find((mm) => mm.value === b.matchMode) || {}).label : '';
                return `<span class="isx-term-wrap"><button type="button" class="isx-term${b.mode === 'or' && b.terms.length > 1 ? ' is-or' : ''}" data-index="${i}" title="Click for the match mode, or to remove it"><span class="isx-term-text">${esc(label)}</span>${mode ? `<span class="isx-term-mode">${esc(mode)}</span>` : ''}<span class="isx-cmd-glyph is-dark" aria-hidden="true"></span></button><button type="button" class="isx-term-remove" data-index="${i}" title="Remove" aria-label="Remove"></button></span>`;
            }).join('');
            if (cm && this.termMenu) list.querySelectorAll('.isx-term').forEach((t) => cm.attachClickMenuToElement(t, this.termMenu));
        }

        renderCommands() {
            const s = this.state;
            const views = this.$('.isx-views-icon');
            const src = `${EX}/views-${this.viewMode}.png`;
            if (views.getAttribute('src') !== src) {
                views.src = src;
                views.srcset = `${src} 1x, ${EX}/views-${this.viewMode}@2x.png 2x`;
            }
            const usages = this.$('.isx-cmd-usages');
            usages.setAttribute('aria-pressed', String(s.view === 'usages'));
            usages.classList.toggle('is-on', s.view === 'usages');
            const picked = !!s.selected && s.view !== 'usages';
            this.$('.isx-cmd-preview').hidden = !picked;
            this.$('.isx-cmd-download').hidden = !picked;
            const frame = this.$('.isx-cmd-frame');
            frame.hidden = !(s.frameId && s.total > 0 && s.view !== 'usages');
            if (!frame.hidden) {
                const f = String(s.frameId);
                this.$('.isx-frame-label').textContent = f === 'screensaver' ? 'Save for the screen saver'
                    : f.startsWith('sideshow:') ? 'Show on the SideShow device' : 'Show in photo frame';
                frame.title = 'Show the pictures of this search.';
            }
            this.$('.isx-cmd-save').disabled = !s.blocks.length;
        }

        renderNav() {
            const s = this.state;
            const cur = activeWs();
            const saved = this.savedSearches();
            const links = [
                { link: 'ws', value: GLOBAL_WS, label: 'All Workspaces', icon: `${EX}/fav-public.png`, on: s.workspaceId === GLOBAL_WS },
                cur ? { link: 'ws', value: cur, label: 'This Workspace', icon: `${EX}/tree-user-16.png`, on: s.workspaceId === cur } : null
            ].filter(Boolean).concat(saved.map((x, i) => ({ link: 'saved', value: String(i), label: x.name, icon: `${EX}/fav-searches.png`, on: false })));
            this.$('.isx-favorite-links').innerHTML = links.map((l) => `<li><button type="button" class="isx-favorite-link${l.on ? ' is-current' : ''}" data-link="${l.link}" data-value="${esc(l.value)}" title="${esc(l.label)}"><img src="${esc(l.icon)}" alt="" draggable="false">${esc(l.label)}</button></li>`).join('');
            const tree = this.$('.isx-tree');
            const open = !tree.firstElementChild || tree.firstElementChild.classList.contains('is-open');
            const rows = omegasearchDsapGetWorkspaceList().map((w) => `<li class="isx-tree-node is-leaf${s.workspaceId === w.id ? ' is-selected' : ''}" role="treeitem" data-ws="${esc(w.id)}"><div class="isx-tree-row" style="--depth:1"><span class="isx-tree-glyph"></span><span class="isx-tree-label"><img class="isx-tree-icon" src="/static_images/vista-icons/explorer/folder-16.png" alt=""><span class="isx-tree-text">${esc(w.name)}</span></span></div></li>`).join('');
            tree.innerHTML = `<li class="isx-tree-node has-children${open ? ' is-open' : ''}${s.workspaceId === GLOBAL_WS ? ' is-selected' : ''}" role="treeitem" data-ws="${GLOBAL_WS}"><div class="isx-tree-row" style="--depth:0"><span class="isx-tree-glyph"></span><span class="isx-tree-label"><img class="isx-tree-icon" src="${EX}/fav-public.png" alt=""><span class="isx-tree-text">All Workspaces</span></span></div><ul class="isx-tree-children" role="group">${rows}</ul></li>`;
        }

        renderLanding() {
            let snap = null;
            try { snap = omegasearchDsapLastActiveSearch; } catch (_) { snap = null; }
            const btn = this.$('.isx-restore');
            const session = snap && snap.queryKey ? this.findSession(snap.queryKey) : null;
            btn.hidden = !(snap && session && (session.total > 0 || Object.keys(session.pages || {}).length));
            if (!btn.hidden) btn.textContent = `Return to your last search: ${snap.label}`;
        }

        rowsSorted() {
            const rows = (this.state.results || []).slice();
            const { field, dir } = this.sort;
            if (!field) return rows;
            const val = (r) => {
                const m = r.metadata || {};
                if (field === 'name') return displayName(r.filename).toLowerCase();
                if (field === 'date') return Number(m.mtime) || 0;
                if (field === 'dims') return (Number(m.width) || 0) * (Number(m.height) || 0);
                if (field === 'size') return Number(m.size) || 0;
                return typeName(r.filename, m);
            };
            rows.sort((a, b) => { const x = val(a); const y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1); });
            return rows;
        }

        renderColumns(cols, sortable) {
            const host = this.$('.isx-columns');
            host.innerHTML = cols.map((c) => `<div class="isx-column${sortable && this.sort.field === c.id ? ` is-sorted is-${this.sort.dir}` : ''}"${sortable ? ` data-sort="${c.id}"` : ''} style="width:${c.width}px" role="columnheader">${esc(c.label)}</div>`).join('') + '<div class="isx-column isx-column-rest"></div>';
        }

        renderResults() {
            const s = this.state;
            const host = this.$('.isx-results');
            const usages = s.view === 'usages';
            if (usages) this.renderColumns(USAGE_COLUMNS, false);
            else this.renderColumns(COLUMNS, true);
            host.dataset.view = usages ? 'usages' : this.viewMode;
            if (!s.blocks.length && s.view === 'search') { host.innerHTML = ''; return; }
            if (s.loading && !s.results.length) {
                host.innerHTML = '<div class="isx-message">Searching...</div>';
                return;
            }
            if (s.failed) { host.innerHTML = `<div class="isx-message">${esc(s.failed)}</div>`; return; }
            if (usages) { this.renderUsages(host); return; }
            if (!s.results.length) {
                host.innerHTML = s.searched ? '<div class="isx-message">No items match your search.</div>' : '';
                return;
            }
            const mode = this.viewMode;
            const thumbs = mode === 'icons-xl' || mode === 'icons-lg' || mode === 'icons-md' || mode === 'tiles';
            const html = this.rowsSorted().map((r) => {
                const m = r.metadata || {};
                const f = r.filename;
                const dims = m.width && m.height ? `${m.width} x ${m.height}` : '';
                const sel = s.selected === f ? ' is-selected' : '';
                // omegasearchDsapPreviewUrl: the gallery's webp preview (assetUrlResolver.js)
                const icon = thumbs
                    ? `<span class="isx-thumb"><img src="${esc(omegasearchDsapPreviewUrl(f))}" alt="" loading="lazy" decoding="async" draggable="false"></span>`
                    : `<img class="isx-type-icon" src="${CMD}/image-file.png" alt="" draggable="false">`;
                if (mode === 'details') {
                    return `<div class="isx-item${sel}" role="option" data-filename="${esc(f)}" title="${esc(f)}">${icon}<span class="isx-cell isx-c-name" style="width:${COLUMNS[0].width - 22}px">${esc(displayName(f))}</span><span class="isx-cell" style="width:${COLUMNS[1].width}px">${esc(fmtDate(m.mtime))}</span><span class="isx-cell" style="width:${COLUMNS[2].width}px">${esc(dims)}</span><span class="isx-cell isx-c-num" style="width:${COLUMNS[3].width}px">${esc(fmtSize(m.size))}</span><span class="isx-cell" style="width:${COLUMNS[4].width}px">${esc(typeName(f, m))}</span></div>`;
                }
                if (mode === 'tiles') {
                    return `<div class="isx-item${sel}" role="option" data-filename="${esc(f)}" title="${esc(f)}">${icon}<span class="isx-tile-text"><span class="isx-label">${esc(displayName(f))}</span><span class="isx-sub">${esc(typeName(f, m))}</span><span class="isx-sub">${esc(dims)}</span></span></div>`;
                }
                return `<div class="isx-item${sel}" role="option" data-filename="${esc(f)}" title="${esc(f)}">${icon}<span class="isx-label">${esc(displayName(f))}</span></div>`;
            }).join('');
            host.innerHTML = html + this.pagerHtml();
        }

        pagerHtml() {
            const s = this.state;
            const pages = Math.max(1, Math.ceil((s.total || 0) / PAGE_SIZE));
            if (pages <= 1) return '';
            return `<div class="isx-pager"><button type="button" class="isx-link" data-page="prev"${s.page <= 1 ? ' disabled' : ''}>&lt; Previous</button><span>Page ${s.page} of ${pages}</span><button type="button" class="isx-link" data-page="next"${s.page >= pages ? ' disabled' : ''}>Next &gt;</button></div>`;
        }

        renderUsages(host) {
            const s = this.state;
            const list = s.usages || [];
            if (!list.length) {
                host.innerHTML = '<div class="isx-message">No prompt usages for this search.</div>';
                return;
            }
            // omegasearchDsapFlattenBlockTerms / HighlightTerms / UsageKey / SourceLabel: omegasearchDsapApplet.js
            const terms = omegasearchDsapFlattenBlockTerms(s.blocks);
            host.innerHTML = list.map((u, i) => {
                const key = omegasearchDsapUsageKey(u, i);
                const open = s.expandedUsages.has(key);
                const where = [omegasearchDsapSourceLabel(u.source)].concat(u.character ? [u.character] : []).join(', ');
                const sel = s.selectedUsage === i ? ' is-selected' : '';
                return `<div class="isx-usage${open ? ' is-open' : ''}${sel}" data-usage="${i}" role="option">
                    <div class="isx-usage-row"><span class="isx-cell" style="width:${USAGE_COLUMNS[0].width}px"><span class="isx-tree-glyph isx-usage-toggle" title="${open ? 'Collapse' : 'Show the full prompt'}"></span>${esc(u.block || '')}</span><span class="isx-cell" style="width:${USAGE_COLUMNS[1].width}px">${esc(where)}</span><span class="isx-cell isx-usage-text" style="width:${USAGE_COLUMNS[2].width}px">${omegasearchDsapHighlightTerms(u.displayText || '', terms)}</span><span class="isx-cell isx-c-num" style="width:${USAGE_COLUMNS[3].width}px">${num(u.fileCount || 0)}</span></div>
                    ${open ? `<div class="isx-usage-full" data-usage-full="${i}">${s.usagePromptCache[key] || 'Loading...'}</div>` : ''}
                </div>`;
            }).join('');
            list.forEach((u, i) => {
                const key = omegasearchDsapUsageKey(u, i);
                if (s.expandedUsages.has(key) && !s.usagePromptCache[key]) void this.fillUsage(i);
            });
        }

        selectedUsage() {
            const i = this.state.selectedUsage;
            return Number.isFinite(i) ? (this.state.usages || [])[i] || null : null;
        }

        toggleUsage(i) {
            const u = (this.state.usages || [])[i];
            if (!u) return;
            const key = omegasearchDsapUsageKey(u, i);
            if (this.state.expandedUsages.has(key)) this.state.expandedUsages.delete(key);
            else this.state.expandedUsages.add(key);
            this.renderResults();
        }

        /** The full prompt behind a usage (the DSAP's _fillUsageExpand: a sample file's metadata). */
        async fillUsage(i) {
            const s = this.state;
            const u = s.usages[i];
            if (!u) return;
            const key = omegasearchDsapUsageKey(u, i);
            const terms = omegasearchDsapFlattenBlockTerms(s.blocks);
            const done = (html) => {
                s.usagePromptCache[key] = html;
                const el = this.$(`[data-usage-full="${i}"]`);
                if (el) el.innerHTML = html;
            };
            const sample = u.sampleFilename || (s.results[0] && s.results[0].filename);
            const client = ws();
            if (u.fullPrompt || !sample || !client || !client.isConnected()) {
                done(usagePromptHtml({ ...u, fullPrompt: u.fullPrompt || u.displayText || '' }, terms));
                return;
            }
            try {
                const meta = await this.metadata(omegasearchDsapNormalizeMetadataFilename(sample));
                done(usagePromptHtml({ ...u, ...usageBundle(meta, u) }, terms));
            } catch (err) {
                done(`<span class="isx-muted">Could not load the full prompt: ${esc((err && err.message) || 'error')}</span>`);
            }
        }

        async copyUsage(full) {
            const s = this.state;
            const i = s.selectedUsage;
            const u = this.selectedUsage();
            if (!u) return;
            let text = u.displayText || '';
            if (full) {
                text = u.fullPrompt || text;
                const cached = s.usagePromptCache[omegasearchDsapUsageKey(u, i)];
                if (!u.fullPrompt && cached) {
                    const tmp = doc.createElement('div');
                    tmp.innerHTML = cached;
                    text = tmp.textContent || text;
                }
            }
            if (!text) return;
            try {
                // copyTextToClipboard: public/scripts/utils/dreamscapeClipboard.js
                await copyTextToClipboard(text);
            } catch (_) { /* the clipboard said no */ }
        }

        onResultsClick(ev) {
            const s = this.state;
            const pager = ev.target.closest('[data-page]');
            if (pager) {
                if (pager.disabled) return;
                const pages = Math.max(1, Math.ceil((s.total || 0) / PAGE_SIZE));
                const next = pager.dataset.page === 'prev' ? s.page - 1 : s.page + 1;
                if (next < 1 || next > pages) return;
                s.page = next;
                s.selected = null;
                this.pushHistory();
                this.runSearch(false);
                this.$('.isx-results').scrollTop = 0;
                return;
            }
            const usage = ev.target.closest('.isx-usage');
            if (usage) {
                const i = Number(usage.dataset.usage);
                if (ev.target.closest('.isx-usage-toggle') || ev.detail === 2) { this.toggleUsage(i); return; }
                if (ev.target.closest('.isx-usage-full')) return;
                s.selectedUsage = i;
                this.$('.isx-results').querySelectorAll('.isx-usage').forEach((x) => x.classList.toggle('is-selected', Number(x.dataset.usage) === i));
                this.renderDetails();
                return;
            }
            const item = ev.target.closest('.isx-item');
            this.select(item ? item.dataset.filename : null);
        }

        onResultsKey(ev) {
            const s = this.state;
            if (s.view === 'usages') return;
            const items = [...this.$('.isx-results').querySelectorAll('.isx-item')];
            if (!items.length) return;
            let i = items.findIndex((x) => x.dataset.filename === s.selected);
            if (ev.key === 'Enter') { if (s.selected) { ev.preventDefault(); this.openProperties(s.selected); } return; }
            if (ev.key === 'Escape') { this.select(null); return; }
            const across = Math.max(1, Math.round(this.$('.isx-results').clientWidth / Math.max(1, items[0].offsetWidth)));
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: this.viewMode === 'details' || this.viewMode === 'list' ? 1 : across, ArrowUp: this.viewMode === 'details' || this.viewMode === 'list' ? -1 : -across, Home: -1e6, End: 1e6 }[ev.key];
            if (step === undefined) return;
            ev.preventDefault();
            i = i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + step));
            this.select(items[i].dataset.filename);
            items[i].scrollIntoView({ block: 'nearest' });
        }

        select(filename) {
            const s = this.state;
            if (s.selected === filename) return;
            s.selected = filename || null;
            this.$('.isx-results').querySelectorAll('.isx-item').forEach((x) => x.classList.toggle('is-selected', x.dataset.filename === s.selected));
            this.renderCommands();
            this.renderDetails();
            if (s.selected && this.panes.details && !this.metaCache.has(s.selected)) {
                const f = s.selected;
                clearTimeout(this.metaTimer);
                this.metaTimer = setTimeout(() => {
                    this.metadata(f).then(() => { if (this.state.selected === f) this.renderDetails(); }).catch(() => {});
                }, 150);
            }
        }

        async metadata(filename) {
            if (this.metaCache.has(filename)) return this.metaCache.get(filename);
            const client = ws();
            if (!client || !client.isConnected()) throw new Error('The server is not connected.');
            const meta = await client.requestImageMetadata(filename);
            this.metaCache.set(filename, meta || null);
            if (this.metaCache.size > 200) this.metaCache.delete(this.metaCache.keys().next().value);
            return meta;
        }

        /** The details pane: the picture (thumbnail, name, type, metadata) or the search's numbers. */
        renderDetails() {
            const s = this.state;
            const icon = this.$('.isx-details-icon');
            const info = this.$('.isx-details-info');
            const row = (label, value) => (value === '' || value == null ? '' : `<div class="isx-details-row"><span class="isx-details-label">${esc(label)}:</span><span class="isx-details-value">${esc(value)}</span></div>`);
            const usage = s.view === 'usages' ? this.selectedUsage() : null;
            if (usage) {
                icon.innerHTML = `<img src="${VI}/search-folder-64.png" srcset="${VI}/search-folder-64.png 1x, ${VI}/search-folder-128.png 2x" alt="">`;
                info.innerHTML = `<div class="isx-details-name">${esc(usage.block || '')}</div><div class="isx-details-type">${esc(omegasearchDsapSourceLabel(usage.source))}${usage.character ? `, ${esc(usage.character)}` : ''}</div><div class="isx-details-grid">${row('Files', num(usage.fileCount || 0))}${row('Text', usage.displayText || '')}</div>`;
                return;
            }
            const r = s.selected && s.view !== 'usages' ? (s.results || []).find((x) => x.filename === s.selected) : null;
            if (s.selected && s.view !== 'usages') {
                const m = (r && r.metadata) || {};
                const meta = this.metaCache.get(s.selected);
                icon.innerHTML = `<span class="isx-thumb"><img src="${esc(omegasearchDsapPreviewUrl(s.selected))}" alt="" draggable="false"></span>`;
                const wsLabel = meta ? omegasearchDsapFormatImageWorkspaces(meta) : '';
                const model = meta ? modelName(meta.model || (typeof determineModelFromMetadata === 'function' ? determineModelFromMetadata(meta) : '')) : '';
                info.innerHTML = `<div class="isx-details-name">${esc(displayName(s.selected))}</div><div class="isx-details-type">${esc(typeName(s.selected, m))}</div><div class="isx-details-grid">${
                    row('Dimensions', m.width && m.height ? `${m.width} x ${m.height}` : '')}${row('Size', fmtSize(m.size))}${row('Date modified', fmtDate(m.mtime))}${
                    row('Workspace', wsLabel && wsLabel !== '\u2014' ? wsLabel : '')}${row('Model', model)}${row('Steps', meta && meta.steps != null ? String(meta.steps) : '')}${
                    row('Guidance', meta && meta.scale != null ? Number(meta.scale).toFixed(1) : '')}${row('Sampler', samplerName(meta))}</div>`;
                return;
            }
            icon.innerHTML = `<img src="${VI}/search-folder-64.png" srcset="${VI}/search-folder-64.png 1x, ${VI}/search-folder-128.png 2x" alt="">`;
            if (s.loading) { info.innerHTML = '<div class="isx-details-name">Searching...</div>'; return; }
            if (!s.searched) { info.innerHTML = `<div class="isx-details-name">${s.blocks.length ? `${s.blocks.length} search ${s.blocks.length === 1 ? 'term' : 'terms'}` : ''}</div>`; return; }
            const pages = Math.max(1, Math.ceil((s.total || 0) / PAGE_SIZE));
            info.innerHTML = `<div class="isx-details-name">${num(s.total)} ${s.total === 1 ? 'item' : 'items'}</div><div class="isx-details-grid">${
                row('Showing', `${num((s.results || []).length)}${pages > 1 ? ` (page ${s.page} of ${pages})` : ''}`)}${row('Prompt usages', num((s.usages || []).length))}${
                row('Location', workspaceLabel(s.workspaceId))}${row('Searched', s.corpusSize != null ? `${num(s.corpusSize)} pictures` : '')}</div>`;
        }

        // ---- navigation pane links, saved searches ----------------------------------------------------

        openLink(kind, value) {
            if (kind === 'ws') { this.setWorkspace(value, true); return; }
            if (kind === 'saved') {
                const x = this.savedSearches()[Number(value)];
                if (!x) return;
                const frame = this.state.frameId;
                this.applyUrl(x.url);
                this.state.frameId = frame;
                if (this.state.blocks.length && this.state.view === 'search') this.state.view = 'gallery';
                this.startFromState(true);
            }
        }

        savedSearches() {
            const list = reg('SavedSearches', []);
            return Array.isArray(list) ? list.filter((x) => x && x.url && x.name) : [];
        }

        async saveSearch() {
            const s = this.state;
            if (!s.blocks.length) return;
            const label = s.blocks.map((b) => omegasearchDsapFormatBlockLabel({ ...b, matchMode: 'substring' })).join(', ');
            const name = typeof showInputDialog === 'function'
                ? await showInputDialog('Save this search as:', label, 'File name', null, null, { title: 'Save Search' })
                : label;
            if (name == null || !String(name).trim()) return;
            const url = omegasearchDsapBuildUrl({
                blocks: s.blocks, view: 'gallery', viewType: s.viewType, workspaceId: s.workspaceId,
                filters: s.filters, promptSource: this.promptSource(), blockOptions: s.blockOptions
            });
            const list = this.savedSearches().filter((x) => x.name !== String(name).trim());
            list.push({ name: String(name).trim(), url, saved: Date.now() });
            setReg({ SavedSearches: list.slice(-20) });
            this.renderNav();
        }

        // ---- the photo frame (frame= in the URL) ------------------------------------------------------

        /** The contract of the DSAP's _saveToPhotoFrame: Sidebar Slide Show (vsbSetFrameSearch),
            the Photos screen saver (personalizationDialogs.setPhotoSearch), SideShow (cplSideShow). */
        saveToPhotoFrame() {
            const s = this.state;
            if (this.panes.advanced) this.readAdvanced();
            const search = {
                blocks: omegasearchDsapBlocksForSearchPayload(s.blocks, s.blockOptions),
                workspaceId: s.workspaceId,
                viewType: s.viewType,
                promptSource: this.promptSource() || '',
                filters: omegasearchDsapBuildFiltersPayload(s.filters),
                blockOptions: { defaultMatchMode: s.blockOptions.defaultMatchMode || 'substring' },
                label: s.blocks.map(omegasearchDsapFormatBlockLabel).filter(Boolean).join(', ')
            };
            const frame = String(s.frameId || '');
            if (frame === 'screensaver') {
                const dialogs = root.personalizationDialogs;
                const ok = !!(dialogs && dialogs.setPhotoSearch(search, s.total));
                toast(ok ? 'success' : 'error', ok ? `The Photos screen saver now shows ${num(s.total)} matching pictures.` : 'The screen saver settings are not open.');
                return;
            }
            if (frame.startsWith('sideshow:')) {
                const id = frame.slice('sideshow:'.length);
                const set = root.cplSideShow ? root.cplSideShow.setDeviceSearch(id, search) : Promise.resolve(false);
                Promise.resolve(set).then((ok) => toast(ok ? 'success' : 'error', ok ? `The SideShow device will show ${num(s.total)} matching pictures.` : 'The SideShow device could not take the search.'));
                return;
            }
            // vsbSetFrameSearch: public/scripts/comp/vistaSidebar.js
            const ok = typeof vsbSetFrameSearch === 'function' && vsbSetFrameSearch(frame, search);
            toast(ok ? 'success' : 'error', ok ? `The photo frame now shows ${num(s.total)} matching pictures.` : 'That photo frame is no longer on the Sidebar.');
        }

        // ---- Properties ----------------------------------------------------------------------------

        openProperties(filename) {
            if (!filename) return;
            const file = omegasearchDsapResolveMetadataFilename(filename, { _state: { results: this.state.results } });
            propsDialog.open(file, this);
        }

        // ---- open / close ------------------------------------------------------------------------------

        show(opts) {
            const m = this.modal;
            const url = opts && opts.url ? opts.url : null;
            if (url || (opts && opts.params)) {
                const frame = this.state.frameId;
                this.applyUrl(url || omegasearchDsapBuildUrl(opts.params));
                if (!hostFor(url || omegasearchDsapBuildUrl(opts.params)).getQueryParam('frame')) this.state.frameId = (opts && opts.keepFrame) ? frame : null;
                if (this.panes.advanced) this.syncAdvanced();
                this.startFromState(true);
            } else if (!this.shown) {
                // a plain open: the last search comes back, as the DSAP restored its session
                this.render();
            }
            this.shown = true;
            if (m.classList.contains('minimised')) call('restoreMinimizedModal', m);
            call('openModal', m);
            m.classList.remove('hidden');
            call('bringModalToFront', m);
            if (!this.state.blocks.length) setTimeout(() => { try { this.$('.isx-search').focus(); } catch (_) { /* gone */ } }, 50);
            return this;
        }

        close() {
            propsDialog.close();
            viewsMenu.close();
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            app = null;
            setTimeout(() => m.remove(), 300);
        }
    }

    // ---- the picture's commands (the DSAP's detail actions and context menu) ----------------------------

    async function imageAction(a, filename, meta, after) {
        // omegasearchDsapResolveDetailImage: a gallery image, or one built from the filename
        const image = omegasearchDsapResolveDetailImage(filename, meta || null);
        switch (a) {
            case 'jump':
                // jumpToGalleryImage: public/scripts/comp/galleryView.js
                return jumpToGalleryImage(filename, omegasearchDsapGetDetailWorkspaceId(meta));
            case 'workspace': {
                const id = omegasearchDsapGetDetailWorkspaceId(meta || (app && await app.metadata(filename).catch(() => null)));
                if (!id) { toast('warning', 'No workspace was found for this picture.'); return null; }
                // setActiveWorkspace: public/scripts/comp/workspaceUtils.js
                return setActiveWorkspace(id);
            }
            case 'studio':
                // openManualModalWithContent: public/scripts/comp/manualModalManager.js
                return openManualModalWithContent({ type: 'image', image, metadata: meta || image.metadata || null });
            case 'favorite':
                // togglePinImage: public/scripts/comp/galleryView.js
                await togglePinImage(image);
                if (after) after();
                return null;
            case 'window': {
                // openGalleryImageInViewer: public/scripts/comp/imageViewer.js (Lumen)
                const viewer = openGalleryImageInViewer(image);
                if (viewer && viewer.element) viewer.element.dataset.imageData = JSON.stringify(image);
                return viewer;
            }
            case 'paint':
                // editGalleryImageInPaint: public/scripts/comp/imageViewer.js
                return editGalleryImageInPaint(image);
            case 'download':
                // downloadImage: public/scripts/comp/galleryView.js
                return downloadImage(image);
            default:
                return null;
        }
    }

    /** The DSAP's _extractUsagePromptBundle. */
    function usageBundle(meta, usage) {
        if (!meta) return { fullPrompt: usage.displayText || '' };
        const source = usage.source || 'prompt';
        const name = usage.character;
        if (source === 'character_prompt' && name) {
            const chars = meta.characterPrompts || [];
            const hit = chars.find((c) => c.chara_name === name) || chars[0];
            return { fullPrompt: (hit && hit.prompt) || usage.displayText || '', fullUc: (hit && hit.uc) || '', characterName: (hit && hit.chara_name) || name };
        }
        if (source === 'v4_character_caption') {
            const chars = meta.compiled_characterPrompts || meta.compiledCharacterPrompts || [];
            const hit = chars.find((c) => c.chara_name === name) || chars[0];
            return { fullPrompt: (hit && hit.prompt) || usage.displayText || '', fullUc: (hit && hit.uc) || '', characterName: (hit && hit.chara_name) || name || 'V4 character' };
        }
        return { fullPrompt: meta.prompt || usage.displayText || '', fullUc: meta.uc || '', characterPrompts: meta.characterPrompts || [] };
    }

    /** The DSAP's _buildUsagePromptHtml, in the window's own classes. */
    function usagePromptHtml(usage, terms) {
        const hl = (t) => omegasearchDsapHighlightTerms(t, terms);
        const parts = [];
        const main = usage.fullPrompt || usage.displayText || '';
        if (main) {
            const label = usage.characterName || usage.source === 'character_prompt' ? 'Character prompt' : 'Main prompt';
            parts.push(`<div class="isx-prompt-label">${esc(label)}</div><div>${hl(main)}</div>`);
        }
        if (usage.fullUc) parts.push(`<div class="isx-prompt-label">UC</div><div>${hl(usage.fullUc)}</div>`);
        if (Array.isArray(usage.characterPrompts) && usage.characterPrompts.length && !usage.characterName) {
            usage.characterPrompts.forEach((c) => {
                if (!c || (!c.prompt && !c.uc)) return;
                parts.push(`<div class="isx-prompt-label">${esc(c.chara_name || 'Character')}</div>`);
                if (c.prompt) parts.push(`<div>${hl(c.prompt)}</div>`);
                if (c.uc) parts.push(`<div class="isx-prompt-label">UC</div><div>${hl(c.uc)}</div>`);
            });
        }
        return parts.join('') || `<span class="isx-muted">${hl(usage.displayText || '')}</span>`;
    }

    // ---- Views: Explorer's slider menu (VM: the seven views down a trackbar, the thumb at the current
    // one; drag it or pick a row). Row centres and rules as measured on the VM (1x). ------------------------

    const VIEWS_MENU_ROWS = { 'icons-xl': 26, 'icons-lg': 68, 'icons-md': 98, 'icons-sm': 144, list: 176, details: 208, tiles: 239 };
    const viewsMenu = {
        el: null,
        owner: null,
        dragging: false,

        build() {
            const el = doc.createElement('div');
            el.className = 'isx-views-menu';
            el.setAttribute('role', 'menu');
            el.hidden = true;
            el.innerHTML = `<div class="isx-vm-track"></div><span class="isx-vm-thumb"></span>${
                VIEW_MODES.map((v) => `<button type="button" class="isx-vm-item" role="menuitemradio" data-mode="${v.id}" style="top:${VIEWS_MENU_ROWS[v.id] - 11}px"><img src="${EX}/views-${v.id}.png" srcset="${EX}/views-${v.id}.png 1x, ${EX}/views-${v.id}@2x.png 2x" alt="">${esc(v.label)}</button>`).join('')
            }${[160, 192, 224].map((y) => `<div class="isx-vm-rule" style="top:${y}px"></div>`).join('')}`;
            doc.body.appendChild(el);
            this.el = el;
            el.addEventListener('click', (ev) => {
                const b = ev.target.closest('.isx-vm-item');
                if (b && this.owner) { this.owner.setViewMode(b.dataset.mode); this.close(); }
            });
            const pick = (clientY) => {
                const top = el.getBoundingClientRect().top;
                const y = clientY - top;
                let best = null;
                Object.entries(VIEWS_MENU_ROWS).forEach(([id, cy]) => { if (!best || Math.abs(cy - y) < Math.abs(best[1] - y)) best = [id, cy]; });
                if (best && this.owner && this.owner.viewMode !== best[0]) this.owner.setViewMode(best[0]);
                this.sync();
            };
            const onDown = (ev) => {
                ev.preventDefault();
                this.dragging = true;
                el.setPointerCapture(ev.pointerId);
                pick(ev.clientY);
            };
            el.querySelector('.isx-vm-track').addEventListener('pointerdown', onDown);
            el.querySelector('.isx-vm-thumb').addEventListener('pointerdown', onDown);
            el.addEventListener('pointermove', (ev) => { if (this.dragging) pick(ev.clientY); });
            el.addEventListener('pointerup', () => { if (this.dragging) { this.dragging = false; this.close(); } });
            doc.addEventListener('pointerdown', (ev) => {
                if (!el.hidden && !el.contains(ev.target) && !(this.owner && this.owner.$('.isx-cmd-views').contains(ev.target))) this.close();
            }, true);
            doc.addEventListener('keydown', (ev) => {
                if (el.hidden) return;
                if (ev.key === 'Escape') { ev.preventDefault(); this.close(); return; }
                if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                ev.preventDefault();
                const i = VIEW_MODES.findIndex((v) => v.id === this.owner.viewMode);
                const next = VIEW_MODES[Math.max(0, Math.min(VIEW_MODES.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
                this.owner.setViewMode(next.id);
                this.sync();
            }, true);
        },

        sync() {
            if (!this.el || !this.owner) return;
            const cur = this.owner.viewMode;
            this.el.querySelector('.isx-vm-thumb').style.top = `${VIEWS_MENU_ROWS[cur] - 4}px`;
            this.el.querySelectorAll('.isx-vm-item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === cur)));
        },

        toggle(owner) {
            if (this.el && !this.el.hidden && this.owner === owner) { this.close(); return; }
            if (!this.el || !this.el.isConnected) this.build();
            this.owner = owner;
            const btn = owner.$('.isx-cmd-views');
            const r = btn.getBoundingClientRect();
            this.el.style.left = `${Math.round(r.left)}px`;
            this.el.style.top = `${Math.round(r.bottom)}px`;
            const z = Number(getComputedStyle(owner.modal).zIndex) || 1000;
            this.el.style.zIndex = String(z + 50);
            this.el.hidden = false;
            btn.classList.add('context-open');
            this.sync();
        },

        close() {
            if (!this.el || this.el.hidden) return;
            this.el.hidden = true;
            this.dragging = false;
            if (this.owner) this.owner.$('.isx-cmd-views').classList.remove('context-open');
        }
    };

    // ---- the Properties sheet (the DSAP's detail view) --------------------------------------------------

    const propsDialog = {
        modal: null,
        file: null,
        meta: null,
        owner: null,
        tab: 'general',
        promptMode: 'input',
        expanderTab: 'genso',
        token: 0,

        build() {
            const m = doc.createElement('div');
            m.id = PROPS_ID;
            m.className = 'modal hidden resizeable-window owned-window isx-props';
            m.dataset.windowIdentifier = 'image-search-properties';
            m.dataset.windowClient = 'light';
            m.dataset.iconOwnerId = MODAL_ID;
            m.dataset.parentModalId = MODAL_ID;
            m.dataset.windowDefaultWidth = '440';
            m.dataset.windowDefaultHeight = '560';
            m.dataset.windowMinWidth = '380';
            m.dataset.windowMinHeight = '420';
            m.dataset.windowNoMaximize = 'true';
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="/static_images/app_icons/24/vista-search.webp" alt=""><span class="isx-props-title">Properties</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small isx-props-x" title="Close"><i class="fa-regular fa-xmark-large"></i></button></div>
                <div class="modal-content win7 isx-props-client">
                    <menu role="tablist" class="isx-props-tabs">
                        <button type="button" role="tab" data-tab="general" aria-selected="true">General</button>
                        <button type="button" role="tab" data-tab="prompts">Prompts</button>
                        <button type="button" role="tab" data-tab="uc">Undesired Content</button>
                        <button type="button" role="tab" data-tab="expanders">Expanders</button>
                    </menu>
                    <article role="tabpanel" class="isx-props-pane">
                        <div class="isx-props-page" data-page="general">
                            <div class="isx-props-head"><span class="isx-props-thumb"><img alt=""></span><div class="isx-props-headtext"><div class="isx-props-name"></div><div class="isx-props-type"></div></div></div>
                            <hr class="isx-props-rule">
                            <div class="isx-props-meta"></div>
                            <hr class="isx-props-rule">
                            <div class="isx-props-actions">
                                <button type="button" class="btn-standard" data-act="jump">Jump to Image</button>
                                <button type="button" class="btn-standard" data-act="workspace">Go to Workspace</button>
                                <button type="button" class="btn-standard" data-act="studio">Open in Studio</button>
                                <button type="button" class="btn-standard" data-act="favorite">Add to Favorites</button>
                                <button type="button" class="btn-standard" data-act="window">Open in Window</button>
                                <button type="button" class="btn-standard" data-act="download">Download</button>
                                <button type="button" class="btn-standard" data-act="paint">Edit in Paint</button>
                            </div>
                        </div>
                        <div class="isx-props-page" data-page="text" hidden>
                            <div class="isx-props-modes"></div>
                            <div class="isx-props-text" tabindex="0"></div>
                        </div>
                        <div class="isx-props-status" hidden></div>
                    </article>
                    <div class="isx-props-footer"><button type="button" class="btn-standard isx-props-ok">OK</button></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            m.querySelector('.isx-props-x').addEventListener('click', () => this.close());
            m.querySelector('.isx-props-ok').addEventListener('click', () => this.close());
            m.querySelector('.isx-props-tabs').addEventListener('click', (ev) => {
                const t = ev.target.closest('[data-tab]');
                if (t) { this.tab = t.dataset.tab; this.render(); }
            });
            m.querySelector('.isx-props-actions').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-act]');
                if (!b || b.disabled || !this.file) return;
                void imageAction(b.dataset.act, this.file, this.meta, () => { this.render(); if (app) app.renderDetails(); });
            });
            m.querySelector('.isx-props-modes').addEventListener('change', (ev) => {
                const r = ev.target.closest('input[type="radio"]');
                if (!r) return;
                if (r.name === 'isx-props-expander') this.expanderTab = r.value;
                else this.promptMode = r.value;
                this.render();
            });
            m.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') { ev.preventDefault(); this.close(); }
            });
            const ctx = root.contextMenu;
            if (ctx) {
                ctx.attachToElement(m.querySelector('.isx-props-thumb'), {
                    sections: [{ type: 'list', initfn: (s) => { s.items = [{ text: 'Open in Window', action: 'window' }, { text: 'Open in Studio', action: 'studio' }, { text: 'Edit in Paint', action: 'paint' }, { separator: true }, { text: 'Download', action: 'download' }]; } }],
                    onAction: (a) => { if (this.file) void imageAction(a, this.file, this.meta); }
                });
            }
        },

        async open(file, owner) {
            if (!this.modal || !this.modal.isConnected) this.build();
            this.owner = owner;
            this.file = file;
            this.meta = owner && owner.metaCache.get(file) ? owner.metaCache.get(file) : null;
            this.tab = 'general';
            const m = this.modal;
            m.querySelector('.isx-props-title').textContent = `${displayName(file)} Properties`;
            const img = m.querySelector('.isx-props-thumb img');
            img.src = `/images/${encodeURIComponent(file)}`;
            this.render();
            if (m.classList.contains('minimised')) call('restoreMinimizedModal', m);
            call('openModal', m);
            m.classList.remove('hidden');
            call('bringModalToFront', m);
            if (this.meta) return;
            const token = ++this.token;
            this.status('Loading the picture\'s details...');
            try {
                const meta = owner ? await owner.metadata(file) : await ws().requestImageMetadata(file);
                if (token !== this.token) return;
                this.meta = meta || null;
                this.status('');
            } catch (err) {
                if (token !== this.token) return;
                this.status((err && err.message) || 'The picture\'s details could not be loaded.');
            }
            this.render();
        },

        status(text) {
            const el = this.modal.querySelector('.isx-props-status');
            el.hidden = !text;
            el.textContent = text || '';
        },

        render() {
            const m = this.modal;
            if (!m) return;
            const meta = this.meta;
            const file = this.file;
            m.querySelectorAll('.isx-props-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === this.tab)));
            m.querySelector('[data-page="general"]').hidden = this.tab !== 'general';
            m.querySelector('[data-page="text"]').hidden = this.tab === 'general';
            const terms = this.owner ? omegasearchDsapFlattenBlockTerms(this.owner.state.blocks) : [];
            const hl = (t) => omegasearchDsapHighlightTerms(t, terms);
            if (this.tab === 'general') {
                const r = this.owner ? (this.owner.state.results || []).find((x) => x.filename === file) : null;
                const dims = (r && r.metadata) || {};
                m.querySelector('.isx-props-name').textContent = displayName(file);
                m.querySelector('.isx-props-type').textContent = typeName(file, dims);
                const rows = [];
                const add = (label, value, html) => { if (value !== '' && value != null) rows.push(`<span class="isx-props-label">${esc(label)}:</span><span class="isx-props-value">${html ? value : esc(value)}</span>`); };
                add('File name', file);
                if (meta) {
                    add('Workspace', omegasearchDsapFormatImageWorkspaces(meta));
                    add('Model', meta.model_display_name || modelName(meta.model || (typeof determineModelFromMetadata === 'function' ? determineModelFromMetadata(meta) : '')) || 'Unknown');
                    add('Preset', meta.preset_name || (meta.forge_data && meta.forge_data.preset_name) || 'Manual');
                    add('Dataset', omegasearchDsapFormatDatasetLabel(meta.dataset_config));
                    let res = '';
                    if (typeof formatResolution === 'function' && (meta.resolution || meta.width)) res = formatResolution(meta.resolution, meta.width, meta.height);
                    else if (meta.width && meta.height) res = `${meta.width} x ${meta.height}`;
                    add('Resolution', res);
                    add('Steps', meta.steps != null ? String(meta.steps) : '');
                    add('Guidance', meta.scale != null ? Number(meta.scale).toFixed(1) : '');
                    add('Sampler', samplerName(meta));
                    add('Seed', meta.seed != null ? String(meta.seed) : '');
                } else {
                    add('Dimensions', dims.width && dims.height ? `${dims.width} x ${dims.height}` : '');
                }
                add('Size', fmtSize(dims.size));
                add('Modified', fmtDate(dims.mtime));
                m.querySelector('.isx-props-meta').innerHTML = rows.join('');
                const pinned = omegasearchDsapIsDetailImagePinned(file, meta);
                const fav = m.querySelector('[data-act="favorite"]');
                fav.textContent = pinned ? 'Remove from Favorites' : 'Add to Favorites';
                m.querySelectorAll('.isx-props-actions [data-act]').forEach((b) => {
                    b.disabled = !file || (b.dataset.act === 'workspace' && !omegasearchDsapGetDetailWorkspaceId(meta));
                });
                return;
            }
            const modes = m.querySelector('.isx-props-modes');
            const text = m.querySelector('.isx-props-text');
            if (this.tab === 'expanders') {
                modes.innerHTML = `<label class="isx-check"><input type="radio" name="isx-props-expander" value="genso"${this.expanderTab === 'genso' ? ' checked' : ''}> Text expanders</label><label class="isx-check"><input type="radio" name="isx-props-expander" value="tenso"${this.expanderTab === 'tenso' ? ' checked' : ''}> Tendai expanders</label>`;
                if (!meta) { text.innerHTML = '<span class="isx-muted">No details yet.</span>'; return; }
                const dg = meta.dynamic_generation || null;
                const list = this.expanderTab === 'tenso'
                    ? ((dg && dg.compiled_prompt && dg.compiled_prompt.text_replacements) || (dg && dg.text_replacements) || dg)
                    : (meta.text_replacements_seed || meta.text_replacements || (meta.forge_data && (meta.forge_data.text_replacements_seed || meta.forge_data.text_replacements)));
                text.innerHTML = expanderHtml(list);
                return;
            }
            modes.innerHTML = `<label class="isx-check"><input type="radio" name="isx-props-mode" value="input"${this.promptMode === 'input' ? ' checked' : ''}> Input prompt</label><label class="isx-check"><input type="radio" name="isx-props-mode" value="compiled"${this.promptMode === 'compiled' ? ' checked' : ''}> Final (compiled)</label>`;
            if (!meta) { text.innerHTML = '<span class="isx-muted">No details yet.</span>'; return; }
            const compiled = this.promptMode === 'compiled';
            // omegasearchDsapResolveDetailPromptFields: public/scripts/comp/omegasearchDsapApplet.js
            const f = omegasearchDsapResolveDetailPromptFields(meta, compiled);
            const parts = [];
            const sec = (title, body) => parts.push(`<div class="isx-prompt-label">${esc(title)}</div><div class="isx-prompt-body">${hl(body)}</div>`);
            if (this.tab === 'uc') {
                const uc = compiled ? (f.mainUc || meta.compiled_uc || meta.uc || '') : f.mainUc;
                if (uc) sec('Undesired content', uc);
                if (f.negPrompt) sec('Negative prompt', f.negPrompt);
                (f.chars || []).forEach((c, i) => { if (c && c.uc) sec(`${c.chara_name || `Character ${i + 1}`} UC`, c.uc); });
                text.innerHTML = parts.join('') || '<span class="isx-muted">No undesired content or negative prompt.</span>';
                return;
            }
            if (f.mainPrompt) sec('Main prompt', f.mainPrompt);
            (f.chars || []).forEach((c, i) => { if (c && c.prompt) sec(`${c.chara_name || `Character ${i + 1}`}${c.enabled === false ? ' (disabled)' : ''}`, c.prompt); });
            text.innerHTML = parts.join('') || '<span class="isx-muted">No prompt.</span>';
        },

        close() {
            if (!this.modal || this.modal.classList.contains('hidden')) return;
            this.token += 1;
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
        }
    };

    function expanderHtml(items) {
        const list = items == null ? [] : (Array.isArray(items) ? items : [items]);
        const rows = list.map((it) => {
            if (it == null) return '';
            if (typeof it === 'string') return `<div class="isx-expander">${esc(it)}</div>`;
            const label = it.name || it.key || it.select_text || it.pattern || it.id || 'Expander';
            const body = it.replacement || it.value || it.text || it.replacement_text || '';
            return `<div class="isx-expander"><div class="isx-prompt-label">${esc(label)}</div>${body ? `<div class="isx-prompt-body">${esc(body)}</div>` : ''}</div>`;
        }).filter(Boolean);
        return rows.join('') || '<span class="isx-muted">None</span>';
    }

    // ---- entry ---------------------------------------------------------------------------------------

    let app = null;

    /**
     * openImageSearch(opts): the Image Search window (one), brought forward when open.
     *   opts.url      a dsap://ispy.dreamscape.jp/?... URL (the DSAP's query: blocks, modes, view,
     *                 viewType, workspace, filters, file, page, frame); its search runs or comes back
     *   opts.params   the same as openIspyDsap's params ({ blocks, view, viewType, workspaceId, filters,
     *                 promptSource, blockOptions, file, page, frame })
     * Needs omegasearchDsapApplet.js loaded first (openImageSearchWindow in dsapManifests.js does it).
     */
    function openImageSearch(opts) {
        if (!doc) return null;
        if (typeof omegasearchDsapBuildUrl !== 'function') {
            console.error('Image Search: omegasearchDsapApplet.js is not loaded');
            return null;
        }
        if (!app || !app.modal.isConnected) app = new ImageSearch();
        return app.show(opts || {});
    }

    root.openImageSearch = openImageSearch;
    root.imageSearchApp = { open: openImageSearch, get: () => app, properties: propsDialog };
})(typeof window !== 'undefined' ? window : globalThis);
