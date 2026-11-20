/**
 * Presentation Settings (#958): Vista's PresentationSettings.exe, 1:1 with the VM. The dialog is the program's own
 * template (PresentationSettings.exe.mui dialog 100, Segoe UI 9; Connected displays... is dialog 101), drawn by
 * vistaDialogTemplate.js; the words are its strings (1006-1022). Opened from Melaton Mobility Center's
 * Presentation Settings tile, Control Panel (Mobility Center > Adjust settings before giving a presentation),
 * Run presentationsettings and the presentation tray icon.
 *
 *   I am currently giving a presentation   turns presentation mode on / off at OK (melatonPresentation.js); only
 *                                          by hand (Yukimi, Nov 19 2026)
 *   Turn off the screen saver, Set the volume to (the Vista trackbar, Low ... High), Show this background
 *   ((None), Vista's wallpapers by file name, Melaton's, a picture picked with Browse...; the preview; Position:
 *   Center / Tile / Fit to screen): saved to the user's registry (melatonPresentation.saveSettings) at OK and
 *   applied at once while presenting
 *   Connected displays...   the displays this computer has now and "I always give a presentation when I use this
 *                           display configuration" for them, off by default (Yukimi, Nov 20 2026): ticked, the
 *                           presentation turns on when this configuration is connected again and off when it goes
 *                           if it was turned on that way (melatonPresentation.js checkDisplays); saved at OK.
 * On a computer that is not a mobile PC Vista says "Presentation settings are available only on mobile PCs."
 *
 *   window.openPresentationSettings()
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const ART = '/static_images/vista-mblctr';
    const ICON = `${ART}/presentationsettings-16.png`;
    const VISTA = '/static_images/wallpapers/vista';
    // PresentationSettings.exe.mui 1010-1012
    const POSITIONS = [{ value: 'center', text: 'Center' }, { value: 'tile', text: 'Tile' }, { value: 'fit', text: 'Fit to screen' }];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /** The backgrounds Vista lists: (None), then the pictures in its wallpaper folder by file name (NTFS order). */
    function backgrounds() {
        const list = [{ path: '', name: '(None)', icon: `${ART}/presentation-none-16.png`, thumb: '' }];
        const vista = [];
        for (let i = 1; i <= 36; i += 1) vista.push(`img${i}`);
        vista.sort();
        vista.forEach((id) => list.push({ path: `url:${VISTA}/${id}.webp`, name: id, icon: `${ART}/picture-16.png`, thumb: `${VISTA}/thumbs/${id}.webp` }));
        /* global STOCK_DESKTOP_WALLPAPERS */
        const stock = typeof STOCK_DESKTOP_WALLPAPERS !== 'undefined' ? STOCK_DESKTOP_WALLPAPERS : [];
        stock.forEach((w) => {
            const url = w.url || '/static_images/wallpapers/aurora.webp';
            const file = url.split('/').pop();
            list.push({ path: `url:${url}`, name: w.name.replace(/ \(default\)$/, ''), icon: `${ART}/picture-16.png`, thumb: `/static_images/wallpapers/thumbs/${file}` });
        });
        return list;
    }

    /** A picture file picked with Browse: url:<the VFS file's address>#<its name> (web_server.js <vfs>/files/:id). */
    function fileRowPath(item) {
        const client = root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
        const base = client && typeof client.getBasePath === 'function' ? client.getBasePath() : null;
        const id = item && (item.targetId || item.id);
        return base && id ? `url:${base}/files/${encodeURIComponent(id)}#${encodeURIComponent(item.name || id)}` : null;
    }

    /** A picture picked with Browse (a picture file, or a gallery print file:<name>) or saved before: its own row. */
    function extraRow(path) {
        const f = /^url:(\/[^#]+\/files\/[^#]+)#(.*)$/.exec(path || '');
        if (f) {
            let name = f[2];
            try { name = decodeURIComponent(name); } catch (_) { /* as stored */ }
            return { path, name: name.replace(/\.[^.]+$/, ''), icon: `${ART}/picture-16.png`, thumb: f[1] };
        }
        const m = /^file:(.+)$/.exec(path || '');
        if (!m) return null;
        /* global localStudioPreviewUrl, localGalleryImageUrl */
        const thumb = (typeof localStudioPreviewUrl === 'function' && localStudioPreviewUrl(m[1])) || (typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(m[1]) : '');
        return { path, name: m[1].replace(/\.[^.]+$/, ''), icon: `${ART}/picture-16.png`, thumb };
    }

    function notMobile() {
        // PresentationSettings.exe.mui 1020 / 1021
        if (typeof root.showConfirmationDialog === 'function') {
            void root.showConfirmationDialog('Presentation settings are available only on mobile PCs.', [{ text: 'OK', value: true }], null, { title: 'Presentation Settings', icon: 'fas fa-triangle-exclamation' });
        }
    }

    function openDisplays(owner) {
        const V = root.vistaDialogTemplate;
        if (!V || !root.melatonPresentation) return;
        let key = '';
        V.openDialog({
            id: 'presentationDisplaysDialog',
            key: 'presentationsettings:101',
            owner,
            icon: ICON,
            captionIcon: true,
            // the VM's line break (GDI's Segoe UI runs a little wider than the browser's)
            overrides: { 119: { text: 'I &always give a presentation when I use this display\nconfiguration.' } },
            init(ctx) {
                const P = root.melatonPresentation;
                key = P.displayKey();
                ctx.options(117, P.displayRows());
                ctx.set(119, P.alwaysFor(key));
                const ok = ctx.el(1);
                if (ok) ok.dataset.dialogPrimary = '1';
            },
            ok(ctx) {
                const P = root.melatonPresentation;
                const on = !!ctx.get(119);
                if (on !== P.alwaysFor(key)) void P.setAlwaysFor(key, on);
            }
        });
    }

    function open() {
        const P = root.melatonPresentation;
        const V = root.vistaDialogTemplate;
        if (!P || !V || !doc) return null;
        if (!P.mobilePc()) { notMobile(); return null; }
        const existing = doc.getElementById('presentationSettingsDialog');
        if (existing && existing.isConnected && !existing.classList.contains('hidden')) {
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(existing);
            return null;
        }
        const s = P.settings();
        const rows = backgrounds();
        const extra = extraRow(s.wallpaper);
        if (extra && !rows.some((r) => r.path === extra.path)) rows.push(extra);
        let selected = s.wallpaper || '';
        let list = null;

        const paintPreview = (ctx) => {
            const box = ctx.holder(110);
            if (!box) return;
            const on = ctx.get(105);
            const row = rows.find((r) => r.path === selected);
            const html = !on ? '' : row && row.thumb ? `<img src="${esc(row.thumb)}" alt="" draggable="false">` : '<span class="prs-black"></span>';
            if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
            box.classList.toggle('is-disabled', !on);
        };

        const paintList = () => {
            if (!list) return;
            list.querySelectorAll('.vdt-lv-row').forEach((el) => el.classList.toggle('is-selected', el.dataset.path === selected));
        };

        const sync = (ctx) => {
            const vol = ctx.get(101);
            [102, 103, 104].forEach((id) => ctx.enable(id, vol));
            const bg = ctx.get(105);
            [106, 107, 108, 109].forEach((id) => ctx.enable(id, bg));
            if (list) list.tabIndex = bg ? 0 : -1;
            paintPreview(ctx);
        };

        const select = (ctx, path, scroll) => {
            selected = path;
            paintList();
            paintPreview(ctx);
            if (scroll && list) {
                const el = Array.from(list.querySelectorAll('.vdt-lv-row')).find((r) => r.dataset.path === path);
                if (el) el.scrollIntoView({ block: 'nearest' });
            }
        };

        const fillList = (ctx) => {
            list = ctx.holder(106);
            if (!list) return;
            list.querySelector('.vdt-lv-body').innerHTML = rows.map((r) => `<div class="vdt-lv-row prs-row" data-path="${esc(r.path)}" role="option"><span><img src="${esc(r.icon)}" alt="" draggable="false">${esc(r.name)}</span></div>`).join('');
            list.addEventListener('click', (ev) => {
                const row = ev.target.closest('.vdt-lv-row');
                if (row && !list.classList.contains('is-disabled')) select(ctx, row.dataset.path, false);
            });
            list.addEventListener('keydown', (ev) => {
                if (list.classList.contains('is-disabled') || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End')) return;
                ev.preventDefault();
                const i = rows.findIndex((r) => r.path === selected);
                const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)));
                select(ctx, rows[n].path, true);
            });
        };

        // Browse...: Vista's Open dialog on the files (Computer, the workspace's folders, network drives), the
        // gallery's prints through Favorite Links > Gallery (studioSession.js studioOpenFolderDialog)
        const PICTURE_EXT = /\.(png|jpe?g|jpe|jfif|gif|bmp|dib|webp|avif|tiff?|ico)$/i;
        const isPictureFile = (item) => !!(item && item.targetKind === 'user-file'
            && (/^image\//.test(item.mimeType || '') || PICTURE_EXT.test(item.name || '')));
        const isGalleryPrint = (item) => !!(item && (item.targetKind === 'image' || item.targetKind === 'scrap') && item.targetId);
        const browse = (ctx) => {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || ''; // eslint-disable-line no-undef
            void root.studioOpenFolderDialog('open-vfs', {
                owner: ctx.modal,
                startPath: ws ? `/Workspaces/${ws}/Desktop` : '/',
                host: {
                    // PresentationSettings.exe.mui 1006, 1009
                    title: 'Browse',
                    rememberKey: 'presentationsettings|browse',
                    types: [{ label: 'All Picture Files (*.bmp; *.dib; *.jpg; *.jpeg; *.jpe; *.jfif; *.gif; *.png; *.webp; *.tif; *.tiff; *.ico)' }],
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => isPictureFile(item) || isGalleryPrint(item),
                    onOpen(item) {
                        const row = extraRow(isGalleryPrint(item) ? `file:${item.targetId}` : fileRowPath(item));
                        if (!row) return;
                        if (!rows.some((r) => r.path === row.path)) {
                            rows.push(row);
                            fillList(ctx);
                        }
                        select(ctx, row.path, true);
                    }
                }
            });
        };

        return V.openDialog({
            id: 'presentationSettingsDialog',
            key: 'presentationsettings:100',
            icon: ICON,
            captionIcon: true,
            overrides: { 110: { html: '' } },
            buttons: {
                107: (ctx) => browse(ctx),
                115: (ctx) => openDisplays(ctx.modal)
            },
            init(ctx) {
                ctx.set(113, P.isOn());
                ctx.set(100, s.screenSaverOff);
                ctx.set(101, s.volumeOn);
                const range = ctx.el(102);
                if (range) { range.min = '0'; range.max = '100'; range.step = '1'; }
                ctx.set(102, s.volume);
                ctx.set(105, s.wallpaperOn);
                ctx.options(109, POSITIONS, s.position);
                const ok = ctx.el(1);
                if (ok) ok.dataset.dialogPrimary = '1';
                ctx.holder(110).classList.add('prs-preview');
                fillList(ctx);
                paintList();
                [101, 105].forEach((id) => ctx.on(id, 'change', () => sync(ctx)));
                const link = ctx.holder(118);
                if (link) link.addEventListener('click', (ev) => { if (ev.target.closest('.vdt-link') && typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('mobility-center'); });
                sync(ctx);
                root.requestAnimationFrame(() => select(ctx, selected, true));
            },
            ok(ctx) {
                const patch = {
                    screenSaverOff: !!ctx.get(100),
                    volumeOn: !!ctx.get(101),
                    volume: Number(ctx.get(102)),
                    wallpaperOn: !!ctx.get(105),
                    wallpaper: selected,
                    position: String(ctx.get(109) || 'fit')
                };
                const presenting = !!ctx.get(113);
                // the registry answers the new values at once; the save to the server goes on behind
                void P.saveSettings(patch);
                if (presenting) P.start(); else P.stop();
            }
        });
    }

    root.openPresentationSettings = open;
})(typeof window !== 'undefined' ? window : globalThis);
