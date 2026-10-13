/**
 * Control Panel's Desktop Background (Yukimi 2026-10-13): Personalization's Select opens Vista's
 * picker page (the VM's Personalization > Desktop Background): "Choose a desktop background",
 * Location ▾ and Browse..., the pictures grouped with a header per group (name and count, a rule,
 * a collapse chevron), OK / Cancel in the grey footer.
 *
 *   Windows Wallpapers   Vista's 36 stock wallpapers (from the VM's Windows\Web\Wallpaper, in
 *                        public/static_images/wallpapers/vista/), grouped by Vista's own
 *                        categories (Black and White, Light Auras, Paintings, Textures, Vistas,
 *                        Widescreen; each file's XMP subject)
 *   Melaton Wallpapers   the aurora set and the default (modalUtils.js STOCK_DESKTOP_WALLPAPERS)
 *   Your Uploads         earlier uploads (modules/wallpaperHistory.js), newest first, each with ×
 *                        to remove it from the history
 *
 * Browse... uploads a picture (modalUtils.js uploadCustomWallpaper) and selects it under Your
 * Uploads. OK (or a double-click) sets the workspace's wallpaper (setDesktopWallpaper, keeping the
 * position) and goes back to Personalization; Cancel goes back unchanged.
 */
(function (root) {
    'use strict';

    const VISTA = '/static_images/wallpapers/vista';
    const CATEGORIES = ['Black and White', 'Light Auras', 'Paintings', 'Textures', 'Vistas', 'Widescreen'];
    const VISTA_WALLPAPERS = [
        { id: 'img1', category: 'Black and White', artist: "Peter deLory" },
        { id: 'img2', category: 'Black and White', artist: "Nicholas Veasey" },
        { id: 'img3', category: 'Black and White', artist: "Jean-Francois Gate" },
        { id: 'img4', category: 'Black and White', artist: "Alan Kearney" },
        { id: 'img25', category: 'Light Auras', artist: "" },
        { id: 'img26', category: 'Light Auras', artist: "" },
        { id: 'img27', category: 'Light Auras', artist: "" },
        { id: 'img28', category: 'Light Auras', artist: "" },
        { id: 'img29', category: 'Light Auras', artist: "" },
        { id: 'img12', category: 'Paintings', artist: "Image by Bettmann/CORBIS" },
        { id: 'img13', category: 'Paintings', artist: "Image by Mary Iverson/CORBIS" },
        { id: 'img14', category: 'Paintings', artist: "Image by J.P.GETTY TRUST/CORBIS SYGMA" },
        { id: 'img15', category: 'Paintings', artist: "Image by Christie's Images/CORBIS" },
        { id: 'img5', category: 'Textures', artist: "Gustavo Siqueira" },
        { id: 'img6', category: 'Textures', artist: "Dina Taylor" },
        { id: 'img7', category: 'Textures', artist: "Darrell Gulin" },
        { id: 'img8', category: 'Textures', artist: "" },
        { id: 'img9', category: 'Textures', artist: "Chuck Kuhn" },
        { id: 'img10', category: 'Textures', artist: "Rosemary Calvert" },
        { id: 'img11', category: 'Textures', artist: "Dana Menussi" },
        { id: 'img16', category: 'Vistas', artist: "Walter Bibikow" },
        { id: 'img17', category: 'Vistas', artist: "Dr. Robert Muntefering" },
        { id: 'img18', category: 'Vistas', artist: "Hamad Darwish" },
        { id: 'img19', category: 'Vistas', artist: "Mark Lewis" },
        { id: 'img20', category: 'Vistas', artist: "Michael Haber" },
        { id: 'img21', category: 'Vistas', artist: "Hamad Darwish" },
        { id: 'img22', category: 'Vistas', artist: "Steve Fu" },
        { id: 'img23', category: 'Vistas', artist: "George Lepp" },
        { id: 'img24', category: 'Vistas', artist: "" },
        { id: 'img30', category: 'Widescreen', artist: "Rosemary Calvert" },
        { id: 'img31', category: 'Widescreen', artist: "George Lepp" },
        { id: 'img32', category: 'Widescreen', artist: "Gustavo Siqueira" },
        { id: 'img33', category: 'Widescreen', artist: "Hamad Darwish" },
        { id: 'img34', category: 'Widescreen', artist: "Mark Lewis" },
        { id: 'img35', category: 'Widescreen', artist: "Steve Fu" },
        { id: 'img36', category: 'Widescreen', artist: "" }
    ];
    const LOCATIONS = [['windows', 'Windows Wallpapers'], ['melaton', 'Melaton Wallpapers'], ['uploads', 'Your Uploads']];

    let main = null;
    let registered = false;
    let state = { location: 'windows', selected: null, collapsed: new Set(), uploads: [] };

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function melatonWallpapers() {
        /* global STOCK_DESKTOP_WALLPAPERS */
        const list = typeof STOCK_DESKTOP_WALLPAPERS !== 'undefined' ? STOCK_DESKTOP_WALLPAPERS : [];
        return list.map((w) => {
            const file = w.url ? w.url.split('/').pop() : 'aurora.webp';
            return { url: w.url, name: w.name, thumb: `/static_images/wallpapers/thumbs/${file}` };
        });
    }

    function windowsWallpapers() {
        return VISTA_WALLPAPERS.map((w) => ({
            url: `${VISTA}/${w.id}.webp`,
            thumb: `${VISTA}/thumbs/${w.id}.webp`,
            name: `${w.category} · ${w.artist}`,
            category: w.category
        }));
    }

    /** The workspace's wallpaper as a URL (null = the default). */
    function currentUrl() {
        /* global workspaces, activeWorkspace */
        const wsId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
        const ws = typeof workspaces !== 'undefined' && workspaces ? workspaces[wsId] : null;
        const path = ws && ws.wallpaper;
        if (!path) return null;
        const [type, ...rest] = String(path).split(':');
        const id = rest.join(':');
        if (type === 'url') return id;
        if (type === 'wallpaper') return `/cache/wallpapers/${encodeURIComponent(`${id}.png`)}`;
        return null;
    }

    function locationFor(url) {
        if (url && url.startsWith(`${VISTA}/`)) return 'windows';
        if (url && url.startsWith('/cache/wallpapers/')) return 'uploads';
        return url ? 'windows' : 'melaton';
    }

    // ---- view ----

    function thumb(item, opts = {}) {
        const selected = (state.selected === undefined ? null : state.selected) === (item.url || null);
        return `
            <div class="cpl-db-pic${selected ? ' is-selected' : ''}" role="option" tabindex="0" aria-selected="${selected}"
                data-cpl-db="pick" data-cpl-db-url="${esc(item.url || '')}" title="${esc(item.name || '')}">
                <span class="cpl-db-frame"><img src="${esc(item.thumb)}" alt="" loading="lazy" draggable="false"></span>
                ${opts.remove ? `<button type="button" class="cpl-db-remove" data-cpl-db="remove" data-cpl-db-id="${esc(item.id)}" title="Remove from Your Uploads" aria-label="Remove from Your Uploads"></button>` : ''}
            </div>`;
    }

    function group(title, items, opts = {}) {
        const key = title;
        const closed = state.collapsed.has(key);
        return `
            <div class="cpl-db-group${closed ? ' is-collapsed' : ''}">
                <button type="button" class="cpl-db-group-head" data-cpl-db="toggle" data-cpl-db-group="${esc(key)}">
                    <span class="cpl-db-group-title">${esc(title)} (${items.length})</span>
                    <span class="cpl-db-group-rule" aria-hidden="true"></span>
                    <span class="cpl-db-chevron" aria-hidden="true"></span>
                </button>
                <div class="cpl-db-pics">${items.map((i) => thumb(i, opts)).join('')}</div>
            </div>`;
    }

    function gridHtml() {
        if (state.location === 'windows') {
            const all = windowsWallpapers();
            return CATEGORIES.map((c) => group(c, all.filter((w) => w.category === c))).join('');
        }
        if (state.location === 'melaton') return group('Melaton Wallpapers', melatonWallpapers());
        if (!state.uploads.length) return '<p class="cpl-db-empty">No uploads yet. Click Browse to upload a picture.</p>';
        return group('Your Uploads', state.uploads.map((u) => ({ id: u.id, url: u.url, thumb: u.url, name: u.name })), { remove: true });
    }

    function html() {
        const label = (LOCATIONS.find(([id]) => id === state.location) || LOCATIONS[0])[1];
        return `
            <h1 class="cpl-page-title">Choose a desktop background</h1>
            <p class="cpl-intro">Click a picture to make it your desktop background. To use a picture that's not listed, click Browse to upload it.</p>
            <div class="cpl-db-location">
                <span>Location</span>
                <button type="button" class="cpl-db-combo" data-cpl-db="location">${esc(label)}</button>
                <button type="button" class="cpl-wu-button" data-cpl-db="browse">Browse...</button>
                <input type="file" accept="image/*" class="hidden" data-cpl-db-file>
            </div>
            <div class="cpl-db-grid" role="listbox">${gridHtml()}</div>
            <div class="cpl-db-footer">
                <button type="button" class="cpl-wu-button" data-cpl-db="ok">OK</button>
                <button type="button" class="cpl-wu-button" data-cpl-db="cancel">Cancel</button>
            </div>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-db-page');
        if (host) host.innerHTML = html();
    }

    // ---- actions ----

    async function loadUploads() {
        const client = root.wsClient;
        if (!client || typeof client.getWallpaperHistory !== 'function') return;
        try {
            const res = await client.getWallpaperHistory();
            state.uploads = (res && res.items) || [];
        } catch (_err) { state.uploads = []; }
    }

    function back() {
        const cpl = root.melatonControlPanel;
        if (cpl) cpl.navigate('personalization');
    }

    async function apply() {
        const url = state.selected || null;
        /* global setDesktopWallpaper, workspaces, activeWorkspace */
        const wsId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
        const ws = typeof workspaces !== 'undefined' && workspaces ? workspaces[wsId] : null;
        const position = (ws && ws.wallpaperPosition) || 'center center';
        let path = null;
        if (url) {
            const m = /^\/cache\/wallpapers\/([^/]+)\.png$/.exec(url);
            path = m ? `wallpaper:${decodeURIComponent(m[1])}` : `url:${url}`;
        }
        if (typeof setDesktopWallpaper === 'function') await setDesktopWallpaper(path, position);
        back();
    }

    function act(action, el, ev) {
        if (action === 'pick') {
            state.selected = el.dataset.cplDbUrl || null;
            main.querySelectorAll('.cpl-db-pic').forEach((p) => {
                const on = p === el;
                p.classList.toggle('is-selected', on);
                p.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            return;
        }
        if (action === 'toggle') {
            const key = el.dataset.cplDbGroup;
            if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
            el.closest('.cpl-db-group').classList.toggle('is-collapsed');
            return;
        }
        if (action === 'location') {
            const cm = root.contextMenu;
            if (!cm) return;
            cm.attachClickMenuToElement(el, {
                position: 'anchor',
                anchorAlign: 'start',
                sections: [{ type: 'list', items: LOCATIONS.map(([id, text]) => ({ text, action: id, highlighted: id === state.location })) }],
                onAction: async (id) => {
                    state.location = id;
                    if (id === 'uploads') await loadUploads();
                    paint();
                }
            });
            if (typeof cm.showMenu === 'function') cm.showMenu(ev, el);
            return;
        }
        if (action === 'browse') {
            const input = main.querySelector('[data-cpl-db-file]');
            if (!input) return;
            input.onchange = async () => {
                const file = input.files && input.files[0];
                if (!file || !file.type.startsWith('image/')) return;
                /* global uploadCustomWallpaper */
                const res = typeof uploadCustomWallpaper === 'function' ? await uploadCustomWallpaper(file) : null;
                await loadUploads();
                state.location = 'uploads';
                const item = res && res.historyItem;
                state.selected = item ? item.url : (state.uploads[0] && state.uploads[0].url) || state.selected;
                paint();
            };
            input.click();
            return;
        }
        if (action === 'remove') {
            ev.stopPropagation();
            const client = root.wsClient;
            const id = el.dataset.cplDbId;
            if (!client || !id) return;
            client.deleteWallpaperHistoryItem(id).then((res) => {
                state.uploads = (res && res.items) || state.uploads.filter((u) => u.id !== id);
                paint();
            }).catch(() => {
                if (typeof root.showGlassToast === 'function') root.showGlassToast('error', null, 'The picture could not be removed', false, 4000);
            });
            return;
        }
        if (action === 'ok') { apply(); return; }
        if (action === 'cancel') back();
    }

    async function mount(el) {
        main = el;
        state.selected = currentUrl();
        state.location = locationFor(state.selected);
        paint();
        await loadUploads();
        if (state.location === 'uploads') paint();
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplDbWired) {
            modal.dataset.cplDbWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-db]');
                if (b && modal.contains(b) && main) act(b.dataset.cplDb, b, ev);
            });
            modal.addEventListener('dblclick', (ev) => {
                const pic = ev.target.closest('.cpl-db-pic');
                if (pic && main && !ev.target.closest('.cpl-db-remove')) { act('pick', pic, ev); apply(); }
            });
            modal.addEventListener('keydown', (ev) => {
                const pic = ev.target.closest && ev.target.closest('.cpl-db-pic');
                if (pic && main && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); act('pick', pic, ev); if (ev.key === 'Enter') apply(); }
            });
        }
    }

    function unmount() {
        main = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerPage('desktop-background', {
            title: () => 'Desktop Background',
            tasks: () => `
                <div class="cpl-task-group cpl-task-group--see-also">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${cpl.taskLinkHtml('Personalization', 'nav', 'personalization')}
                    </ul>
                </div>`,
            body: () => '<div class="cpl-db-page"></div>',
            mount,
            unmount
        });
        return true;
    }

    root.cplDesktopBackground = {
        register,
        open: () => register() && root.melatonControlPanel.navigate('desktop-background'),
        VISTA_WALLPAPERS,
        CATEGORIES,
        _test: { html: (st) => { state = { ...state, ...st }; return html(); }, locationFor }
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplDesktopBackground;
})(typeof window !== 'undefined' ? window : globalThis);
