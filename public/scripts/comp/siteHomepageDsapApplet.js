/**
 * Site Homepage DSAP - install cover-site gate and access phrase.
 * Domain: site.dreamscape.jp
 */

const SITE_HOMEPAGE_DSAP_URL = 'site.dreamscape.jp';
const SITE_HOMEPAGE_DSAP_ID = 'site-homepage';

const siteHomepageDsapCss = `
[data-dsap="site-homepage"] {
    color: var(--dsap-smf-fg);
}
[data-dsap="site-homepage"] .site-homepage-dsap-label {
    font-weight: bold;
    color: var(--dsap-smf-fg);
    margin-right: 6px;
    align-self: center;
    white-space: nowrap;
}
[data-dsap="site-homepage"] .site-homepage-dsap-row {
    margin: 6px 0;
}
[data-dsap="site-homepage"] .site-homepage-dsap-row .dsap-smf-input {
    width: min(420px, 100%);
}
[data-dsap="site-homepage"] .site-homepage-phrase-input {
    max-width: min(560px, 100%);
}
[data-dsap="site-homepage"] .site-homepage-slug-dropdown {
    min-width: 200px;
}
[data-dsap="site-homepage"] .site-homepage-dsap-empty {
    color: #444;
    font-size: var(--dsap-smf-font-size-sm);
    padding: 8px 0;
}
`;

function siteHomepagePageHtml() {
    return `${dsapSmfBuildRootOpen(SITE_HOMEPAGE_DSAP_ID)}
${dsapSmfBuildHeader({ branchTitle: DSAP_SMF_BRANCH_DREAMSCAPE, toolTitle: 'Site Homepage' })}
${dsapSmfBuildSectionHdr('Access gate')}
${dsapSmfBuildStatusBox('Pick a cover site folder under resources/site-homepages/, set the lookup phrase (hash only on server), and apply. Visitors without the access token see that site only.')}
${dsapSmfBuildStatusBox('Loading…', 'siteHomepageStatusBox', 'siteHomepageStatus')}
<div class="dsap-smf-toolbar site-homepage-dsap-row">
  <span class="site-homepage-dsap-label">Cover site</span>
  <div class="custom-dropdown site-homepage-slug-dropdown">
    <button type="button" id="siteHomepageSlugBtn" class="custom-dropdown-btn hover-show colored">
      <span id="siteHomepageSlugSelected">—</span>
    </button>
    <div id="siteHomepageSlugMenu" class="custom-dropdown-menu hidden"></div>
  </div>
  <input type="hidden" id="siteHomepageSlugHidden" value="">
</div>
<div class="dsap-smf-toolbar site-homepage-dsap-row">
  <label class="site-homepage-dsap-label" for="siteHomepagePhrase">Access phrase</label>
  <input class="dsap-smf-input site-homepage-phrase-input" type="password" id="siteHomepagePhrase" autocomplete="new-password" maxlength="512" placeholder="Write-only; server stores hash only (up to 512 characters)">
</div>
${dsapSmfBuildToolbar(`<button type="button" class="dsap-smf-btn" id="siteHomepageInstall">Apply</button>
<button type="button" class="dsap-smf-btn" id="siteHomepagePreview">Preview in Alchemy</button>
<button type="button" class="dsap-smf-btn" id="siteHomepageClear">Turn off gate</button>`)}
${dsapSmfBuildStatusBox('Preview opens the cover site in a new Alchemy window (same files and styling as production).')}
${dsapSmfBuildRootClose()}`;
}

const siteHomepageDsapDriver = {
    init(host) {
        this._state = { host, slugs: [], slugDropdownContainer: null };
        const root = host.getRoot();
        root.querySelector('#siteHomepageInstall').addEventListener('click', () => this._install());
        root.querySelector('#siteHomepagePreview').addEventListener('click', () => this._preview());
        root.querySelector('#siteHomepageClear').addEventListener('click', () => this._clear());
        this._wireSlugDropdown(root);
        this._load();
    },

    destroy() {
        const root = this._state && this._state.host && this._state.host.getRoot();
        if (root && typeof teardownDropdown === 'function') {
            root.querySelectorAll('.custom-dropdown').forEach((el) => teardownDropdown(el));
        }
        this._state = null;
    },

    refresh() {
        this._load();
    },

    _wireSlugDropdown(root) {
        const container = root.querySelector('.site-homepage-slug-dropdown');
        const btn = root.querySelector('#siteHomepageSlugBtn');
        const menu = root.querySelector('#siteHomepageSlugMenu');
        const hidden = root.querySelector('#siteHomepageSlugHidden');
        const selected = root.querySelector('#siteHomepageSlugSelected');
        if (!container || !btn || !menu || !hidden || !selected) return;
        this._state.slugDropdownContainer = container;
        // setupDropdown: public/scripts/comp/dropdown.js
        // renderSimpleDropdown: public/scripts/comp/manualDropdownManager.js
        setupDropdown(
            container,
            btn,
            menu,
            (selectedVal) => {
                const items = (this._state.slugs || []).map((slug) => ({ value: slug, name: slug }));
                renderSimpleDropdown(
                    menu,
                    items,
                    'value',
                    'name',
                    (value) => {
                        hidden.value = value;
                        selected.textContent = value;
                        this._state.selectedSlug = value;
                    },
                    () => closeDropdown(menu, btn),
                    selectedVal,
                    { preventFocusTransfer: true }
                );
            },
            () => hidden.value || this._state.selectedSlug,
            { preventFocusTransfer: true }
        );
    },

    _setSlugSelection(slug, slugs) {
        const root = this._state.host.getRoot();
        const hidden = root.querySelector('#siteHomepageSlugHidden');
        const selected = root.querySelector('#siteHomepageSlugSelected');
        const btn = root.querySelector('#siteHomepageSlugBtn');
        const list = slugs || [];
        if (!slug || !list.includes(slug)) {
            slug = list.length ? list[0] : '';
        }
        this._state.selectedSlug = slug || null;
        this._state.slugs = list;
        if (hidden) hidden.value = slug;
        if (selected) selected.textContent = slug || 'No cover sites';
        if (btn) btn.disabled = list.length === 0;
    },

    _status(text, level) {
        const el = this._state.host.getRoot().querySelector('#siteHomepageStatus');
        const box = this._state.host.getRoot().querySelector('#siteHomepageStatusBox');
        if (el) el.textContent = text || '';
        if (box) {
            box.classList.remove('dsap-smf-status-error', 'dsap-smf-status-ok');
            if (level === 'error') box.classList.add('dsap-smf-status-error');
            if (level === 'success') box.classList.add('dsap-smf-status-ok');
        }
        if (level && this._state.host.showToast) {
            const kind = level === 'success' ? 'success' : level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info';
            this._state.host.showToast(kind, null, text);
        }
    },

    async _load() {
        try {
            const data = await wsClient.sendMessage('get_site_homepage', {}, false);
            const configured = data && data.configured;
            const homepage = data && data.homepage;
            const available = data && data.available;
            const slugs = Array.isArray(available) ? available : [];
            if (slugs.length === 0) {
                this._setSlugSelection('', []);
                this._status('No folders in resources/site-homepages/ (each needs index.html).', 'warning');
                return;
            }
            const pick = homepage && slugs.includes(homepage) ? homepage : slugs[0];
            this._setSlugSelection(pick, slugs);
            this._status(
                configured ? `Active cover: ${homepage}` : 'Gate is off (normal PIN login at /).',
                configured ? 'info' : null
            );
        } catch (err) {
            this._status('Could not load site homepage settings', 'error');
        }
    },

    _selectedSlug() {
        const root = this._state.host.getRoot();
        const hidden = root.querySelector('#siteHomepageSlugHidden');
        return (hidden && hidden.value) || this._state.selectedSlug;
    },

    async _install() {
        const slug = this._selectedSlug();
        if (!slug) {
            this._status('Pick a cover site first', 'warning');
            return;
        }
        const phraseEl = this._state.host.getRoot().querySelector('#siteHomepagePhrase');
        const phrase = phraseEl ? phraseEl.value : '';
        try {
            await wsClient.sendMessage('set_site_homepage', { slug, phrase }, false);
            if (phraseEl) phraseEl.value = '';
            this._status(`Active cover: ${slug}`, 'success');
            this._load();
        } catch (err) {
            this._status(err && err.message ? err.message : 'Install failed', 'error');
        }
    },

    async _preview() {
        const slug = this._selectedSlug();
        if (!slug) {
            this._status('Pick a cover site to preview', 'warning');
            return;
        }
        try {
            const data = await wsClient.sendMessage('mint_site_homepage_preview_url', { slug }, false);
            const previewPath = data && data.previewPath;
            if (!previewPath) {
                this._status('Could not start preview', 'error');
                return;
            }
            const url = `${location.origin}${previewPath}`;
            // openGrimoireStandaloneUrl: public/scripts/comp/featureLoader.js
            if (typeof openGrimoireStandaloneUrl !== 'function') {
                this._status('Alchemy is not available', 'error');
                return;
            }
            // Same path as desktop web shortcuts (desktopShortcuts.handleWebPageClick):
            // grimoireOpenStandaloneWindow in grimoireRemoteBrowser.js — not openGrimoireUrl / tagWikiSearchModal.navigate.
            await featureLoader.loadFeature('grimoire');
            const title = slug.replace(/-/g, ' ');
            grimoireOpenStandaloneWindow(url, null, `Cover preview: ${title}`);
        } catch (err) {
            this._status(err && err.message ? err.message : 'Preview failed', 'error');
        }
    },

    async _clear() {
        try {
            await wsClient.sendMessage('clear_site_homepage', {}, false);
            this._status('Site gate disabled', 'success');
            this._load();
        } catch (err) {
            this._status('Could not disable gate', 'error');
        }
    }
};

function registerSiteHomepageDsapApplet() {
    if (typeof registerDsap !== 'function') return;
    registerDsap({
        url: SITE_HOMEPAGE_DSAP_URL,
        getContent() {
            return {
                html: siteHomepagePageHtml(),
                css: siteHomepageDsapCss,
                drivers: siteHomepageDsapDriver,
                theme: 'dsap-smf',
                menuEntry: {
                    adminOnly: true
                }
            };
        }
    });
}

registerSiteHomepageDsapApplet();
