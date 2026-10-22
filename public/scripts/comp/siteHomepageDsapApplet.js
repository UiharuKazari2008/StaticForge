/**
 * Site Homepage DSAP - install cover-site gate and access phrase.
 * Domain: site.dreamscape.jp
 */

const SITE_HOMEPAGE_DSAP_URL = 'site.dreamscape.jp';
const SITE_HOMEPAGE_DSAP_ID = 'site-homepage';

const siteHomepageDsapCss = `
[data-dsap="site-homepage"] .site-homepage-slug-list { margin: 0 0 12px; }
[data-dsap="site-homepage"] .site-homepage-slug-list label { display: block; margin: 4px 0; }
[data-dsap="site-homepage"] .site-homepage-preview-frame {
    width: 100%;
    min-height: 320px;
    border: 1px solid #808080;
    background: #fff;
    margin-top: 8px;
}
`;

function siteHomepagePageHtml() {
    return `${dsapSmfBuildRootOpen(SITE_HOMEPAGE_DSAP_ID)}
${dsapSmfBuildHeader({ branchTitle: DSAP_SMF_BRANCH_DREAMSCAPE, toolTitle: 'Site Homepage' })}
${dsapSmfBuildSectionHdr('Access gate')}
${dsapSmfBuildStatusBox('Pick a cover homepage, set the lookup phrase (never stored on the client), and install. Visitors without the access token see the cover site only.')}
<p id="siteHomepageStatus"></p>
<div class="site-homepage-slug-list" id="siteHomepageSlugList"></div>
<p>
<label for="siteHomepagePhrase">Access phrase</label><br>
<input class="dsap-smf-input" type="password" id="siteHomepagePhrase" autocomplete="new-password" placeholder="Write-only; server stores hash only">
</p>
<p>
<button type="button" class="dsap-smf-btn" id="siteHomepageInstall">Install</button>
<button type="button" class="dsap-smf-btn" id="siteHomepagePreview">Preview</button>
<button type="button" class="dsap-smf-btn" id="siteHomepageClear">Turn off gate</button>
</p>
${dsapSmfBuildSectionHdr('Preview')}
<iframe class="site-homepage-preview-frame" id="siteHomepagePreviewFrame" title="Homepage preview" sandbox="allow-same-origin"></iframe>
${dsapSmfBuildRootClose()}`;
}

const siteHomepageDsapDriver = {
    init(host) {
        this._state = { host, selectedSlug: null };
        const root = host.getRoot();
        root.querySelector('#siteHomepageInstall').addEventListener('click', () => this._install());
        root.querySelector('#siteHomepagePreview').addEventListener('click', () => this._preview());
        root.querySelector('#siteHomepageClear').addEventListener('click', () => this._clear());
        this._load();
    },

    destroy() {
        this._state = null;
    },

    refresh() {
        this._load();
    },

    _status(text, level) {
        const el = this._state.host.getRoot().querySelector('#siteHomepageStatus');
        if (el) el.textContent = text || '';
        if (level && this._state.host.showToast) {
            this._state.host.showToast(text, level);
        }
    },

    _renderSlugs(available, current) {
        const list = this._state.host.getRoot().querySelector('#siteHomepageSlugList');
        if (!list) return;
        const slugs = Array.isArray(available) ? available : [];
        if (slugs.length === 0) {
            list.innerHTML = '<p>No cover sites found under .cache/site-homepage/available/</p>';
            return;
        }
        this._state.selectedSlug = current && slugs.includes(current) ? current : slugs[0];
        list.innerHTML = slugs.map((slug) => {
            const checked = slug === this._state.selectedSlug ? ' checked' : '';
            return `<label><input type="radio" name="siteHomepageSlug" value="${dsapSmfEscapeAttr(slug)}"${checked}> ${dsapSmfEscapeHtml(slug)}</label>`;
        }).join('');
        list.querySelectorAll('input[name="siteHomepageSlug"]').forEach((input) => {
            input.addEventListener('change', () => {
                if (input.checked) this._state.selectedSlug = input.value;
            });
        });
    },

    async _load() {
        try {
            const data = await wsClient.sendMessage('get_site_homepage', {}, false);
            const configured = data && data.configured;
            const homepage = data && data.homepage;
            this._renderSlugs(data && data.available, homepage);
            this._status(configured ? `Active: ${homepage}` : 'Gate is off (PIN login surface).', configured ? 'info' : null);
        } catch (err) {
            this._status('Could not load site homepage settings', 'error');
        }
    },

    _selectedSlug() {
        const root = this._state.host.getRoot();
        const picked = root.querySelector('input[name="siteHomepageSlug"]:checked');
        return (picked && picked.value) || this._state.selectedSlug;
    },

    async _install() {
        const slug = this._selectedSlug();
        const phraseEl = this._state.host.getRoot().querySelector('#siteHomepagePhrase');
        const phrase = phraseEl ? phraseEl.value : '';
        try {
            await wsClient.sendMessage('set_site_homepage', { slug, phrase }, false);
            if (phraseEl) phraseEl.value = '';
            this._status(`Installed ${slug}`, 'success');
            this._load();
        } catch (err) {
            this._status(err && err.message ? err.message : 'Install failed', 'error');
        }
    },

    async _preview() {
        const slug = this._selectedSlug();
        const frame = this._state.host.getRoot().querySelector('#siteHomepagePreviewFrame');
        if (!frame || !slug) return;
        try {
            const preview = await wsClient.sendMessage('get_site_homepage_preview', { slug }, false);
            const html = preview && preview.html;
            if (!html) {
                this._status('Preview empty', 'warning');
                return;
            }
            frame.srcdoc = html;
        } catch (err) {
            this._status('Preview failed', 'error');
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
