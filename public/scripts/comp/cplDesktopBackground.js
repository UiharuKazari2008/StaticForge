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
 *   Japan / Europe / USA / fukapon (Flickr)
 *                        photo galleries (Yukimi 2026-10-22; wallpaperGalleries.js, files in
 *                        public/static_images/wallpapers/photos/<gallery>/), one group per place.
 *                        A selected photo shows its credit under the list: title, photographer,
 *                        license and a link to the original on Flickr or Wikimedia Commons
 *
 * Browse... uploads a picture (modalUtils.js uploadCustomWallpaper) and selects it under Your
 * Uploads. "How should the picture be positioned?" holds the wallpaper's horizontal and vertical
 * alignment (moved here from the old Personalize page, 2026-10-21; Manual adds a slider). OK (or a
 * double-click) sets the workspace's wallpaper and position (setDesktopWallpaper) and goes back;
 * Cancel goes back unchanged.
 *
 * openWith(path) is "Set as desktop background" from a gallery or Explorer picture: the page opens
 * with that picture selected under Selected Picture (modalUtils.js openDesktopSettingsModal).
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
    /* global WALLPAPER_GALLERIES */
    const GALLERIES = typeof WALLPAPER_GALLERIES !== 'undefined' ? WALLPAPER_GALLERIES : (root.WALLPAPER_GALLERIES || []);
    const LOCATIONS = [['windows', 'Windows Wallpapers'], ['melaton', 'Melaton Wallpapers'],
        ...GALLERIES.map((g) => [g.id, g.label]), ['uploads', 'Your Uploads']];

    const ALIGN = {
        horizontal: [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['custom', 'Manual']],
        vertical: [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom'], ['custom', 'Manual']]
    };

    let main = null;
    let registered = false;
    let state = {
        location: 'windows',
        selected: null,
        collapsed: new Set(),
        uploads: [],
        pending: null,  // { path, url }: a picture handed in by openWith
        current: null,  // { path, url }: the workspace's wallpaper when the page opened
        pos: { h: 'center', v: 'center', ch: 50, cv: 50 }
    };

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

    /** A photo gallery's pictures, each with its credit (wallpaperGalleries.js). */
    function galleryWallpapers(gallery) {
        return gallery.items.map((w) => ({
            url: `${gallery.dir}/${w.f}.webp`,
            thumb: `${gallery.dir}/thumbs/${w.f}.webp`,
            name: w.a ? `${w.t || 'Untitled'} · ${w.a}` : (w.t || ''),
            group: gallery.groups[w.g],
            credit: w
        }));
    }

    function galleryFor(url) {
        return url ? GALLERIES.find((g) => url.startsWith(`${g.dir}/`)) || null : null;
    }

    /** The credit of a gallery photo by its URL, or null. */
    function creditFor(url) {
        const gallery = galleryFor(url);
        if (!gallery) return null;
        const file = url.slice(gallery.dir.length + 1).replace(/\.webp$/, '');
        return gallery.items.find((w) => w.f === file) || null;
    }

    function workspaceRecord() {
        /* global workspaces, activeWorkspace */
        const wsId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
        return typeof workspaces !== 'undefined' && workspaces ? workspaces[wsId] : null;
    }

    /** A wallpaper path (type:id, modalUtils.js) as the URL that shows it. */
    function pathToUrl(path) {
        if (!path) return null;
        const [type, ...rest] = String(path).split(':');
        const id = rest.join(':');
        /* global localGalleryImageUrl, localCacheUploadUrl, localCachePreviewUrl */
        switch (type) {
            case 'url': return id;
            case 'wallpaper': return `/cache/wallpapers/${encodeURIComponent(`${id}.png`)}`;
            case 'file': return typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(id) : `/images/${encodeURIComponent(id)}`;
            case 'cache': return typeof localCacheUploadUrl === 'function' ? localCacheUploadUrl(id) : null;
            case 'cache-preview': return typeof localCachePreviewUrl === 'function' ? localCachePreviewUrl(id) : null;
            case 'vibe': return `/cache/vibe/${id}`;
            default: return null;
        }
    }

    /** The workspace's wallpaper as a URL (null = the default). */
    function currentUrl() {
        const ws = workspaceRecord();
        return pathToUrl(ws && ws.wallpaper);
    }

    function readPosition() {
        const ws = workspaceRecord();
        const [h = 'center', v = 'center'] = String((ws && ws.wallpaperPosition) || 'center center').split(/\s+/);
        const pct = (t) => (String(t).endsWith('%') ? Math.min(100, Math.max(0, parseInt(t, 10) || 0)) : null);
        return {
            h: pct(h) !== null ? 'custom' : (ALIGN.horizontal.some(([k]) => k === h) ? h : 'center'),
            v: pct(v) !== null ? 'custom' : (ALIGN.vertical.some(([k]) => k === v) ? v : 'center'),
            ch: pct(h) !== null ? pct(h) : 50,
            cv: pct(v) !== null ? pct(v) : 50
        };
    }

    function positionValue() {
        const p = state.pos;
        return `${p.h === 'custom' ? `${p.ch}%` : p.h} ${p.v === 'custom' ? `${p.cv}%` : p.v}`;
    }

    function locationFor(url) {
        if (url && url.startsWith(`${VISTA}/`)) return 'windows';
        if (url && url.startsWith('/cache/wallpapers/')) return 'uploads';
        const gallery = galleryFor(url);
        if (gallery) return gallery.id;
        return url ? 'windows' : 'melaton';
    }

    // ---- view ----

    function thumb(item, opts = {}) {
        const selected = (state.selected === undefined ? null : state.selected) === (item.url || null);
        return `
            <div class="cpl-db-pic${selected ? ' is-selected' : ''}" tabindex="0"
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
        const handed = state.pending
            ? group('Selected Picture', [{ url: state.pending.url, thumb: state.pending.url, name: 'Selected picture' }])
            : '';
        return handed + locationHtml();
    }

    function locationHtml() {
        if (state.location === 'windows') {
            const all = windowsWallpapers();
            return CATEGORIES.map((c) => group(c, all.filter((w) => w.category === c))).join('');
        }
        if (state.location === 'melaton') return group('Melaton Wallpapers', melatonWallpapers());
        const gallery = GALLERIES.find((g) => g.id === state.location);
        if (gallery) {
            const all = galleryWallpapers(gallery);
            return gallery.groups.map((g) => group(g, all.filter((w) => w.group === g))).join('');
        }
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
            <div class="cpl-db-grid">${gridHtml()}</div>
            ${GALLERIES.some((g) => g.id === state.location) ? `<div class="cpl-db-credit" aria-live="polite">${creditHtml(state.selected)}</div>` : ''}
            <div class="cpl-db-position">
                <div class="cpl-db-position-title">How should the picture be positioned?</div>
                <div class="cpl-db-position-row">
                    ${alignHtml('horizontal', 'Horizontal', state.pos.h, state.pos.ch)}
                    ${alignHtml('vertical', 'Vertical', state.pos.v, state.pos.cv)}
                </div>
            </div>
            <div class="cpl-db-footer">
                <button type="button" class="cpl-wu-button" data-cpl-db="ok">OK</button>
                <button type="button" class="cpl-wu-button" data-cpl-db="cancel">Cancel</button>
            </div>`;
    }

    /** "Title" by Photographer · License · View on Flickr; links open in Alchemy (featureLoader.js catchWebLinkClick). */
    function creditHtml(url) {
        const w = creditFor(url);
        if (!w) return '';
        const link = (href, text) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));
        const site = /flickr\.com/.test(w.s) ? 'Flickr' : 'Wikimedia Commons';
        const parts = [`<span class="cpl-db-credit-title">${esc(w.t || 'Untitled')}</span>${w.a ? ` by ${link(w.au, w.a)}` : ''}`];
        if (w.l) parts.push(link(w.lu, w.l));
        if (w.s) parts.push(link(w.s, `View on ${site}`));
        return parts.join(' <span class="cpl-db-credit-sep">·</span> ');
    }

    function alignHtml(axis, label, value, pct) {
        const name = (ALIGN[axis].find(([k]) => k === value) || ALIGN[axis][1])[1];
        return `
            <div class="cpl-db-align">
                <span class="cpl-db-align-label">${label}</span>
                <button type="button" class="cpl-db-combo cpl-db-align-combo" data-cpl-db-axis="${axis}">${esc(name)}</button>
                <span class="cpl-db-align-manual${value === 'custom' ? '' : ' hidden'}">
                    <input type="range" min="0" max="100" step="1" value="${pct}" data-cpl-db-pct="${axis}" aria-label="${label} position">
                    <span class="cpl-db-align-pct">${pct}%</span>
                </span>
            </div>`;
    }

    function paint() {
        if (!main || !main.isConnected) return;
        const host = main.querySelector('.cpl-db-page');
        if (!host) return;
        host.innerHTML = html();
        // contextMenu.attachPickerMenu: public/scripts/comp/contextMenu.js
        // Wire before the click. Attaching inside the click misses the mousedown that opens the menu.
        const cm = root.contextMenu;
        const locationBtn = host.querySelector('[data-cpl-db="location"]');
        if (!cm || !locationBtn) return;
        host.querySelectorAll('[data-cpl-db-axis]').forEach((btn) => {
            const axis = btn.dataset.cplDbAxis;
            const key = axis === 'horizontal' ? 'h' : 'v';
            cm.attachPickerMenu(btn, {
                items: () => ALIGN[axis].map(([value, text]) => ({ value, text })),
                value: () => state.pos[key],
                onSelect: (value) => {
                    state.pos[key] = value;
                    btn.textContent = (ALIGN[axis].find(([k]) => k === value) || ALIGN[axis][1])[1];
                    btn.parentElement.querySelector('.cpl-db-align-manual').classList.toggle('hidden', value !== 'custom');
                }
            });
        });
        host.querySelectorAll('[data-cpl-db-pct]').forEach((input) => {
            input.addEventListener('input', () => {
                const key = input.dataset.cplDbPct === 'horizontal' ? 'ch' : 'cv';
                state.pos[key] = Number(input.value) || 0;
                input.parentElement.querySelector('.cpl-db-align-pct').textContent = `${state.pos[key]}%`;
            });
        });
        cm.attachPickerMenu(locationBtn, {
            items: () => LOCATIONS.map(([id, text]) => ({ value: id, text })),
            value: () => state.location,
            onSelect: (id) => {
                state.location = id;
                const ready = id === 'uploads' ? loadUploads() : Promise.resolve();
                ready.then(() => paint());
            }
        });
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
        if (!cpl) return;
        // Vista returns to the page it came from; opened on its own it goes to Personalization
        if (typeof cpl.goBack === 'function' && cpl.currentPage() === 'desktop-background') {
            cpl.goBack(); // no history: stays here, and goes to Personalization below
            if (cpl.currentPage() !== 'desktop-background') return;
        }
        cpl.navigate('personalization');
    }

    async function apply() {
        const url = state.selected || null;
        /* global setDesktopWallpaper */
        const position = positionValue();
        let path = null;
        if (url && state.pending && url === state.pending.url) {
            path = state.pending.path;
        } else if (url && state.current && url === state.current.url) {
            path = state.current.path; // a gallery or uploaded picture keeps its own kind of path
        } else if (url) {
            const m = /^\/cache\/wallpapers\/([^/]+)\.png$/.exec(url);
            path = m ? `wallpaper:${decodeURIComponent(m[1])}` : `url:${url}`;
        }
        state.pending = null;
        if (typeof setDesktopWallpaper === 'function') await setDesktopWallpaper(path, position);
        back();
    }

    function act(action, el, ev) {
        if (action === 'pick') {
            state.selected = el.dataset.cplDbUrl || null;
            main.querySelectorAll('.cpl-db-pic').forEach((p) => {
                p.classList.toggle('is-selected', p === el);
            });
            const credit = main.querySelector('.cpl-db-credit');
            if (credit) credit.innerHTML = creditHtml(state.selected);
            return;
        }
        if (action === 'toggle') {
            const key = el.dataset.cplDbGroup;
            if (state.collapsed.has(key)) state.collapsed.delete(key); else state.collapsed.add(key);
            el.closest('.cpl-db-group').classList.toggle('is-collapsed');
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
        const ws = workspaceRecord();
        state.current = ws && ws.wallpaper ? { path: ws.wallpaper, url: currentUrl() } : null;
        state.pos = readPosition();
        state.selected = state.pending ? state.pending.url : currentUrl();
        state.location = locationFor(state.pending ? null : state.selected);
        if (state.pending) state.location = 'windows';
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
        state.pending = null;
    }

    function register() {
        if (registered) return true;
        const cpl = root.melatonControlPanel;
        if (!cpl || typeof cpl.registerPage !== 'function') return false;
        registered = true;
        cpl.registerPage('desktop-background', {
            title: () => 'Desktop Background',
            parent: 'personalization',
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
        /** Open with a picture (a wallpaper path, type:id) selected. */
        openWith: (path) => {
            if (!register()) return false;
            const url = pathToUrl(path);
            state.pending = url ? { path, url } : null;
            root.melatonControlPanel.navigate('desktop-background');
            return true;
        },
        VISTA_WALLPAPERS,
        CATEGORIES,
        GALLERIES,
        _test: { html: (st) => { state = { ...state, ...st }; return html(); }, locationFor, creditFor }
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplDesktopBackground;
})(typeof window !== 'undefined' ? window : globalThis);
