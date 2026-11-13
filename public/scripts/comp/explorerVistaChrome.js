/**
 * Cartograph as Vista's Windows Explorer (Yozora #449, 1:1 with the Vista VM's Explorer).
 * explorerApplet.js keeps the file logic; this draws the Explorer chrome around it:
 *
 *   breadcrumb      the address box shows the path as crumbs (Root ▸ Workspaces ▸ Default ▸ …);
 *                   a crumb navigates, a click on the empty part of the box types a path, the
 *                   box's ▾ lists the places visited; the ▾ after the orbs is Recent Pages
 *                   (the back / forward history, the current page checked)
 *   command bar     Organize ▾ (New Folder, Sort By, Cut, Copy, Paste, Rename, Delete), Views ▾ and the
 *                   contextual Upload / Download / Replace; the old icon buttons stay hidden in
 *                   the markup and do the work (their disabled state drives the menu)
 *   navigation pane Favorite Links (this workspace's Desktop / Pictures / References / Notes,
 *                   Workspaces, Library, Trash; three and More » while Folders is open) and the
 *                   Folders bar opening Vista's namespace tree (Desktop ▸ workspace, Workspaces,
 *                   Computer ▸ drives, Control Panel, Recycle Bin), open down to the folder on screen
 *   details pane    the selected item (icon, name, type, Date modified, Size) or the folder's
 *                   item count
 *   Details view    Vista's type names (File Folder, PNG Image) and dates (11/2/2006 8:24 AM)
 *
 * Art from the VM (public/static_images/vista-explorer/, scripts/assets/vista-explorer-parts/),
 * styles in public/css/vista-explorer.css. The applet calls renderBreadcrumb / renderDetails /
 * syncCommands from updateLocationLabels / renderStatusText / updateToolbarState.
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-explorer';

    // Vista's type names by extension (HKCR friendly names); others read "<EXT> File"
    const EXT_TYPES = {
        png: 'PNG Image', jpg: 'JPEG Image', jpeg: 'JPEG Image', gif: 'GIF Image', bmp: 'Bitmap Image',
        webp: 'WebP Image', avif: 'AVIF Image', tif: 'TIFF Image', tiff: 'TIFF Image', ico: 'Icon',
        svg: 'SVG Document', txt: 'Text Document', md: 'Markdown Document', json: 'JSON File',
        html: 'HTML Document', htm: 'HTML Document', css: 'Cascading Style Sheet Document',
        js: 'JScript Script File', pdf: 'PDF Document', zip: 'Compressed (zipped) Folder',
        mp3: 'MP3 Format Sound', wav: 'Wave Sound', ogg: 'OGG File', mp4: 'MP4 Video', webm: 'WebM Video',
        mov: 'QuickTime Movie', gifv: 'GIF Video',
        // 7-Zip's own names for the formats it is associated with ("7z Archive"; zip stays Vista's)
        '7z': '7z Archive', rar: 'rar Archive', tar: 'tar Archive', gz: 'gz Archive', tgz: 'tgz Archive',
        bz2: 'bz2 Archive', tbz: 'tbz Archive', tbz2: 'tbz2 Archive', xz: 'xz Archive', txz: 'txz Archive',
        lzma: 'lzma Archive', zst: 'zst Archive', z: 'z Archive', cab: 'cab Archive', iso: 'iso Archive',
        wim: 'wim Archive', arj: 'arj Archive', lzh: 'lzh Archive', lha: 'lha Archive', cpio: 'cpio Archive',
        rpm: 'rpm Archive', deb: 'deb Archive', dmg: 'dmg Archive', xar: 'xar Archive', vhd: 'vhd Archive',
        squashfs: 'squashfs Archive', '001': '001 Archive'
    };

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** "/" as Vista names it: the system drive, Local Disk (C:) (explorerComputerView.js). */
    function rootLabel() {
        return (root.ExplorerComputerView && root.ExplorerComputerView.ROOT_NAME) || 'Cartograph';
    }

    class ExplorerVistaChrome {
        constructor(app) {
            this.app = app;
            const $ = (id) => document.getElementById(id);
            this.labels = new Map([['/', rootLabel()]]);
            this.treeSpecs = new WeakMap();
            this.el = {
                addressGroup: app.modal.querySelector('.explorer-address-group'),
                breadcrumb: $('explorerBreadcrumb'),
                address: $('explorerAddressBar'),
                addressDrop: $('explorerAddressDropBtn'),
                recentPages: $('explorerRecentPagesBtn'),
                organize: $('explorerOrganizeBtn'),
                upload: $('explorerUploadCmd'),
                download: $('explorerDownloadCmd'),
                replace: $('explorerReplaceCmd'),
                preview: $('explorerPreviewCmd'),
                systemProperties: $('explorerSystemPropertiesCmd'),
                uninstall: $('explorerUninstallCmd'),
                controlPanel: $('explorerControlPanelCmd'),
                help: $('explorerHelpBtn'),
                favorites: $('explorerFavoriteLinks'),
                folders: $('explorerFolders'),
                foldersBar: $('explorerFoldersBar'),
                favoritesMore: $('explorerFavoritesMore'),
                tree: $('explorerFolderTree'),
                detailsIcon: $('explorerDetailsIcon'),
                detailsInfo: $('explorerDetailsInfo')
            };
            this.wire();
            this.renderFavorites();
            // phones coming and going over ActiveSync: Computer's node in the tree lists them again
            const as = root.activeSync;
            if (as && typeof as.on === 'function') as.on('state', () => this.refreshTreeComputer());
        }

        /** Rebuilds Computer's children in the tree when its devices changed (only while it is open). */
        refreshTreeComputer() {
            const tree = this.el.tree;
            const view = this.app.computer;
            if (!tree || !view || !view.portableDevices || !root.ExplorerComputerView) return;
            const sig = JSON.stringify(view.portableDevices().map((d) => [d.key, d.name, d.files]));
            if (sig === this._treeDeviceSig) return;
            this._treeDeviceSig = sig;
            const li = [...tree.querySelectorAll('.explorer-tree-node')].find((n) => n.dataset.path === root.ExplorerComputerView.PATH);
            if (!li || !li._treeLoad) return;
            li._treeLoad = null;
            if (li.classList.contains('is-open')) void this.expandTreeNode(li).then(() => this.syncTree());
        }

        // ---- breadcrumb ----

        wire() {
            const e = this.el;
            if (e.breadcrumb) {
                e.breadcrumb.addEventListener('click', (ev) => {
                    // « opens its menu (layoutBreadcrumb), not the typed address
                    if (ev.target.closest('.explorer-crumb-overflow')) return;
                    const crumb = ev.target.closest('[data-crumb-path]');
                    if (crumb) {
                        ev.stopPropagation();
                        this.app.navigateTo(crumb.dataset.crumbPath);
                        return;
                    }
                    this.editAddress();
                });
            }
            if (e.address) {
                e.address.addEventListener('blur', () => this.leaveAddress());
                e.address.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        e.address.blur();
                    } else if (ev.key === 'Enter') {
                        // explorerApplet.js navigates on Enter; the crumbs come back after it
                        setTimeout(() => e.address.blur(), 0);
                    }
                });
            }

            const proxy = (btnId) => {
                const btn = document.getElementById(btnId);
                if (btn && !btn.disabled) btn.click();
            };
            if (e.upload) e.upload.addEventListener('click', () => proxy('explorerUploadBtn'));
            if (e.download) e.download.addEventListener('click', () => proxy('explorerDownloadBtn'));
            if (e.replace) e.replace.addEventListener('click', () => proxy('explorerReplaceBtn'));
            if (e.preview && typeof root.contextMenu !== 'undefined' && root.contextMenu) this.attachPreviewMenu();
            // Computer's commands: Control Panel > System, Control Panel (melatonControlPanel.js, cplSystem.js)
            const controlPanel = (page) => {
                const loader = root.featureLoader;
                const ready = loader && typeof loader.loadFeature === 'function' ? loader.loadFeature('control_panel') : Promise.resolve();
                Promise.resolve(ready).then(() => {
                    if (page === 'system' && root.cplSystem) root.cplSystem.open();
                    else if (page === 'programs' && root.melatonControlPanel && root.melatonControlPanel.openItem) root.melatonControlPanel.openItem('programs');
                    else if (root.melatonControlPanel) root.melatonControlPanel.open(page);
                }).catch((err) => console.error('Control Panel', err));
            };
            if (e.systemProperties) e.systemProperties.addEventListener('click', () => controlPanel('system'));
            if (e.controlPanel) e.controlPanel.addEventListener('click', () => controlPanel('home'));
            // Vista's Computer: Uninstall or change a program opens Programs and Features (cplPages.js)
            if (e.uninstall) e.uninstall.addEventListener('click', () => controlPanel('programs'));
            if (e.help) {
                e.help.addEventListener('click', () => {
                    if (typeof root.openGrimoireApplet === 'function') root.openGrimoireApplet();
                });
            }
            if (e.organize && typeof root.contextMenu !== 'undefined' && root.contextMenu) {
                const refresh = () => this.attachOrganizeMenu();
                e.organize.addEventListener('pointerenter', refresh);
                e.organize.addEventListener('pointerdown', refresh, true);
                e.organize.addEventListener('focus', refresh);
                refresh();
            }
            if (typeof root.contextMenu !== 'undefined' && root.contextMenu) {
                // menus built when they open: the history changes under them
                if (e.recentPages) {
                    const attach = () => this.attachHistoryMenu(e.recentPages, () => this.recentPagesItems());
                    e.recentPages.addEventListener('pointerdown', attach, true);
                    e.recentPages.addEventListener('focus', attach);
                    attach();
                }
                if (e.addressDrop) {
                    const attach = () => this.attachHistoryMenu(e.addressDrop, () => this.visitedItems());
                    e.addressDrop.addEventListener('pointerdown', attach, true);
                    e.addressDrop.addEventListener('focus', attach);
                    attach();
                }
            }
            if (e.foldersBar) {
                e.foldersBar.addEventListener('click', () => this.toggleFolders());
            }
            if (e.favorites) {
                e.favorites.addEventListener('click', (ev) => {
                    const link = ev.target.closest('[data-path]');
                    if (link) this.app.navigateTo(link.dataset.path);
                });
            }
            if (e.favoritesMore) e.favoritesMore.addEventListener('pointerdown', () => this.attachFavoritesMore(), true);
            if (e.tree) {
                // the glyph opens and closes a node; the name goes there (Vista: a double-click also expands)
                e.tree.addEventListener('click', (ev) => {
                    const li = ev.target.closest('.explorer-tree-node');
                    if (!li || !e.tree.contains(li)) return;
                    ev.preventDefault();
                    if (ev.target.closest('.explorer-tree-glyph')) {
                        this.toggleTreeNode(li);
                        return;
                    }
                    if (ev.target.closest('.explorer-tree-label')) this.openTreeNode(li);
                });
                e.tree.addEventListener('dblclick', (ev) => {
                    const li = ev.target.closest('.explorer-tree-node');
                    if (li && ev.target.closest('.explorer-tree-label')) this.toggleTreeNode(li, true);
                });
            }
        }

        /** True while the Vista chrome shows (desktop, not the classic theme). */
        isOn() {
            const b = document.body;
            return !!b && b.classList.contains('desktop-mode') && !b.classList.contains('windows-classic-theme');
        }

        labelFor(path) {
            if (this.labels.has(path)) return this.labels.get(path);
            const last = String(path || '/').split('/').filter(Boolean).pop();
            return last || rootLabel();
        }

        /** Recent Pages: forward pages on top, the current one checked, then back (Vista's order). */
        recentPagesItems() {
            const { history, historyIndex } = this.app;
            const items = [];
            for (let i = Math.min(history.length - 1, historyIndex + 4); i >= Math.max(0, historyIndex - 4); i--) {
                const current = i === historyIndex;
                items.push(current
                    ? { text: this.labelFor(history[i]), action: `h:${i}`, indicatorStyle: 'dot', checked: true }
                    : { text: this.labelFor(history[i]), action: `h:${i}`, icon: 'fas fa-folder' });
            }
            return items;
        }

        /** The address box's list: each place visited once, newest first. */
        visitedItems() {
            const seen = new Set();
            const items = [];
            for (let i = this.app.history.length - 1; i >= 0 && items.length < 12; i--) {
                const path = this.app.history[i];
                if (seen.has(path)) continue;
                seen.add(path);
                items.push({ text: path === '/' ? rootLabel() : path, action: `p:${path}`, icon: 'fas fa-folder' });
            }
            return items;
        }

        attachHistoryMenu(btn, build) {
            const cm = root.contextMenu;
            cm.detachClickMenuFromElement(btn);
            cm.attachClickMenuToElement(btn, {
                sections: [{ type: 'list', items: build() }],
                onAction: (action) => {
                    if (action.startsWith('p:')) this.app.navigateTo(action.slice(2));
                    else if (action.startsWith('h:')) this.goToHistory(Number(action.slice(2)));
                }
            });
        }

        /** Jump within the history like several Back / Forward presses (explorerApplet goBack). */
        goToHistory(index) {
            const app = this.app;
            if (app._loading || !Number.isInteger(index) || index === app.historyIndex) return;
            if (index < 0 || index >= app.history.length) return;
            app.historyIndex = index;
            app.currentPath = app.history[index];
            app._applyViewModeForPath(app.currentPath);
            app.updateLocationLabels(null);
            const token = app._beginNavigation();
            app.refresh(token).finally(() => app._endNavigation(token));
        }

        typeLabel(item) {
            if (!item) return '';
            if (item.isUploadPlaceholder) return 'Upload';
            if (item.targetKind === 'workspace') return 'Workspace';
            if (this.app.isFolderItem && this.app.isFolderItem(item)) {
                return item.system || item.targetKind === 'system-folder' || item.kind === 'system-folder' ? 'System Folder' : 'File Folder';
            }
            // Vista names a file by what it is (PNG Image, Shortcut); the server's own wording last
            if (item.shortcutType || item.isShortcut || item.isDesktopShortcut) return 'Shortcut';
            const ext = String(item.name || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
            if (ext && EXT_TYPES[ext]) return EXT_TYPES[ext];
            const mime = String(item.mimeType || '');
            const sub = mime.split('/')[1];
            if (sub) {
                const name = sub.replace(/^x-/, '').split(/[+.;]/)[0].toUpperCase();
                if (mime.startsWith('image/')) return `${name === 'JPEG' ? 'JPEG' : name} Image`;
                if (mime.startsWith('video/')) return `${name} Video`;
                if (mime.startsWith('audio/')) return `${name} Sound`;
                if (mime.startsWith('text/')) return name === 'PLAIN' ? 'Text Document' : `${name} Document`;
            }
            if (ext) return `${ext.toUpperCase()} File`;
            if (item.typeLabel) return item.typeLabel;
            return this.app._fallbackTypeLabel ? this.app._fallbackTypeLabel(item) : 'File';
        }

        /** Vista's own icon pitch. Extra Large 256, Large 96, Medium 48, Small 16,
            plus the label. Details and List stay the 19px row. */
        modeMetrics(viewMode) {
            if (viewMode === 'details' || viewMode === 'list') return { rowHeight: 19 };
            if (viewMode === 'icons-xl') return { rowHeight: 312, cellWidth: 272 };
            if (viewMode === 'icons-lg') return { rowHeight: 152, cellWidth: 112 };
            if (viewMode === 'icons-md') return { rowHeight: 104, cellWidth: 96 };
            if (viewMode === 'icons-sm') return { rowHeight: 72, cellWidth: 88 };
            return null;
        }

        /** 11/2/2006 8:24 AM */
        formatDate(ts) {
            if (!ts) return '';
            const d = new Date(ts * 1000);
            if (Number.isNaN(d.getTime())) return '';
            return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
        }

        editAddress() {
            const { addressGroup, address } = this.el;
            if (!addressGroup || !address) return;
            addressGroup.classList.add('is-editing');
            address.focus();
            address.select();
        }

        leaveAddress() {
            if (this.el.addressGroup) this.el.addressGroup.classList.remove('is-editing');
        }

        /** displayPath has one label per path segment (explorerApplet _fallbackDisplayPath / stats).
            Vista's trail starts at Computer: Computer ▸ Local Disk (C:) ▸ Workspaces ▸ … */
        renderBreadcrumb(displayPath) {
            const host = this.el.breadcrumb;
            if (!host) return;
            const computer = typeof root.ExplorerComputerView === 'function' && !!this.app.computer;
            const atComputer = computer && root.ExplorerComputerView.isPath(this.app.currentPath);
            const crumbs = computer ? [{ label: 'Computer', path: root.ExplorerComputerView.PATH }] : [];
            // Computer ▸ <device>: a portable device's page (explorerComputerView.js)
            const deviceId = atComputer ? root.ExplorerComputerView.deviceIdOf(this.app.currentPath) : null;
            if (deviceId) crumbs.push({ label: this.app.computer.deviceName(deviceId), path: this.app.currentPath });
            const phone = root.explorerPhoneDrive && root.explorerPhoneDrive.isPath(this.app.currentPath);
            if (phone) {
                // Computer ▸ Phone ▸ Internal storage ▸ DCIM (explorerPhoneDrive.js)
                root.explorerPhoneDrive.crumbs(this.app.currentPath).forEach((c) => crumbs.push(c));
            } else if (!atComputer) {
                const parts = String(this.app.currentPath || '/').split('/').filter(Boolean);
                const labels = String(displayPath || '/').split('/').filter(Boolean);
                // a network drive hangs off Computer, not off Local Disk (explorerSequenzia.js)
                const network = root.explorerSequenzia && root.explorerSequenzia.isPath(this.app.currentPath);
                if (!network) crumbs.push({ label: rootLabel(), path: '/' });
                parts.forEach((part, i) => {
                    crumbs.push({ label: labels[i] || part, path: '/' + parts.slice(0, i + 1).join('/') });
                });
            }
            crumbs.forEach((c) => this.labels.set(c.path, c.label));
            this.crumbs = crumbs;
            // the place's own icon: Computer, the drive, or a folder
            const current = this.app.currentPath;
            this.crumbIcon = atComputer ? (deviceId ? 'portable-device-16.png' : 'computer-16.png') : (current === '/' && computer ? 'drive-system-16.png' : 'crumb-folder.png');
            // the Contacts folder's own icon (wab32res IDI_ICON_FOLDER, explorerContacts.js)
            if (root.explorerContacts && root.explorerContacts.isPath(current)) this.crumbIcon = '../vista-contacts/folder-16.png';
            if (phone) this.crumbIcon = root.explorerPhoneDrive.crumbIcon(current);
            if (root.explorerSequenzia && current === root.explorerSequenzia.ROOT) this.crumbIcon = 'drive-network-16.png';
            this.layoutBreadcrumb();
            this.watchBreadcrumbWidth();
            this.highlightFavorite();
            this.syncTree();
        }

        /** Vista drops the trailing ▸ first, then folds crumbs from the left into « (a menu of them). */
        layoutBreadcrumb() {
            const host = this.el.breadcrumb;
            const crumbs = this.crumbs || [];
            if (!host) return;
            const cm = typeof root.contextMenu !== 'undefined' ? root.contextMenu : null;
            const oldOverflow = host.querySelector('.explorer-crumb-overflow');
            if (oldOverflow && cm) cm.detachClickMenuFromElement(oldOverflow);
            const sep = '<span class="explorer-crumb-sep" aria-hidden="true"></span>';
            const crumb = (c) => `<button type="button" class="explorer-crumb" data-crumb-path="${esc(c.path)}">${esc(c.label)}</button>`;
            const draw = (folded, trailing) => {
                const shown = crumbs.slice(folded);
                host.innerHTML = `<img class="explorer-crumb-icon" src="${ART}/${this.crumbIcon || 'crumb-folder.png'}" alt="">`
                    + (folded ? '<button type="button" class="explorer-crumb-overflow" title="Previous locations" aria-label="Previous locations"></button>' : '')
                    + shown.map((c, i) => (folded && i === 0 ? '' : sep) + crumb(c)).join('')
                    + (trailing ? sep : '');
            };
            const fits = () => host.scrollWidth <= host.clientWidth;
            draw(0, true);
            // hidden (address being typed, window closed): nothing to measure
            if (!host.clientWidth || fits()) {
                this.foldedCrumbs = 0;
                return;
            }
            draw(0, false);
            let folded = 0;
            while (!fits() && folded < crumbs.length - 1) {
                folded += 1;
                draw(folded, false);
            }
            this.foldedCrumbs = folded;
            const overflow = host.querySelector('.explorer-crumb-overflow');
            if (overflow && cm) {
                // the folded places, nearest first
                const items = crumbs.slice(0, folded).reverse().map((c) => ({ text: c.label, action: `p:${c.path}`, icon: 'fas fa-folder' }));
                cm.attachClickMenuToElement(overflow, {
                    sections: [{ type: 'list', items }],
                    onAction: (action) => {
                        if (action.startsWith('p:')) this.app.navigateTo(action.slice(2));
                    }
                });
            }
        }

        /** The trail refits when the window (and so the box) changes width. */
        watchBreadcrumbWidth() {
            const host = this.el.breadcrumb;
            if (this._crumbObserver || !host || typeof root.ResizeObserver !== 'function') return;
            let lastWidth = host.clientWidth;
            this._crumbObserver = new root.ResizeObserver(() => {
                const w = host.clientWidth;
                if (w === lastWidth) return;
                lastWidth = w;
                this.layoutBreadcrumb();
            });
            this._crumbObserver.observe(host);
        }

        // ---- command bar ----

        attachOrganizeMenu() {
            const btn = this.el.organize;
            const cm = root.contextMenu;
            if (!btn || !cm) return;
            const live = (id) => {
                const b = document.getElementById(id);
                return !!b && !b.disabled && !b.classList.contains('hidden');
            };
            const isWsList = this.app._isWorkspacesListPath && this.app._isWorkspacesListPath();
            const entries = [
                { id: 'explorerNewFolderBtn', text: isWsList ? 'New Workspace' : 'New Folder', icon: 'fas fa-folder-plus' },
                { separator: true },
                { sortBy: true },
                { separator: true },
                { id: 'explorerCutBtn', text: 'Cut', icon: 'fas fa-cut' },
                { id: 'explorerCopyBtn', text: 'Copy', icon: 'fas fa-copy' },
                { id: 'explorerPasteBtn', text: 'Paste', icon: 'fas fa-paste' },
                { separator: true },
                { id: 'explorerRenameBtn', text: 'Rename', icon: 'fas fa-i-cursor' },
                { id: 'explorerDeleteBtn', text: 'Delete', icon: 'fas fa-trash' }
            ];
            cm.detachClickMenuFromElement(btn);
            cm.attachClickMenuToElement(btn, {
                sections: [{
                    type: 'list',
                    items: entries.map((it) => {
                        if (it.separator) return { separator: true };
                        // Sort By (contextMenu.js vistaSortByMenu, explorerApplet.js applySort)
                        if (it.sortBy) return this.app.sortByMenuItem ? this.app.sortByMenuItem() : { separator: true };
                        return { icon: it.icon, text: it.text, action: it.id, disabled: !live(it.id) };
                    })
                }],
                onAction: (action) => {
                    if (this.app.handleSortAction && this.app.handleSortAction(action)) return;
                    const b = document.getElementById(action);
                    if (b && !b.disabled) b.click();
                }
            });
        }

        /** The one selected picture: a gallery print, or an image file in a VFS folder (Paint opens both). */
        selectedPicture() {
            const sel = this.app.grid ? this.app.grid.getSelectedItems() : [];
            if (sel.length !== 1) return null;
            const item = sel[0];
            if (item.targetKind === 'image' || item.targetKind === 'scrap') return item;
            if (item.targetKind === 'user-file' && /^image\/(png|jpe?g|bmp|webp|gif)$/i.test(item.mimeType || '')) return item;
            return null;
        }

        /** Preview's menu: the programs that open a picture, as Vista lists Windows Photo Gallery and Paint. */
        attachPreviewMenu() {
            const btn = this.el.preview;
            const cm = root.contextMenu;
            if (!btn || !cm) return;
            cm.attachClickMenuToElement(btn, {
                sections: [{
                    type: 'list',
                    items: [
                        { text: 'Lumen', action: 'explorer-preview-lumen' },
                        { text: 'Paint', action: 'explorer-preview-paint' }
                    ]
                }],
                onAction: (action) => {
                    const item = this.selectedPicture();
                    if (!item) return;
                    if (action === 'explorer-preview-lumen') void this.app.openItem(item);
                    else if (action === 'explorer-preview-paint') {
                        // editInPaint: explorerApplet.js; editGalleryImageInPaint: imageViewer.js
                        if (item.targetKind === 'user-file') void this.app.editInPaint(item);
                        else if (typeof root.editGalleryImageInPaint === 'function') void root.editGalleryImageInPaint(this.app._resolveGalleryImage(item));
                    }
                }
            });
        }

        /** Contextual commands follow the hidden buttons' state (explorerApplet updateToolbarState). */
        syncCommands() {
            const shown = (cmd, legacyId) => {
                if (!cmd) return;
                const b = document.getElementById(legacyId);
                const on = !!b && !b.disabled && !b.classList.contains('hidden');
                cmd.classList.toggle('hidden', !on);
            };
            shown(this.el.upload, 'explorerUploadBtn');
            shown(this.el.download, 'explorerDownloadBtn');
            shown(this.el.replace, 'explorerReplaceBtn');
            if (this.el.preview) this.el.preview.classList.toggle('hidden', !this.selectedPicture());
            // Computer's own commands; a device's page (Computer ▸ <device>) has only Organize and Views (VM)
            const atComputer = typeof this.app._isComputerPath === 'function' && this.app._isComputerPath()
                && !(root.ExplorerComputerView && root.ExplorerComputerView.deviceIdOf(this.app.currentPath));
            if (this.el.systemProperties) this.el.systemProperties.classList.toggle('hidden', !atComputer);
            if (this.el.uninstall) this.el.uninstall.classList.toggle('hidden', !atComputer);
            if (this.el.controlPanel) this.el.controlPanel.classList.toggle('hidden', !atComputer);
        }

        // ---- navigation pane ----

        favoriteLinks() {
            const ws = typeof root.activeWorkspace !== 'undefined' && root.activeWorkspace
                ? root.activeWorkspace
                : (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null);
            const links = [];
            if (ws) {
                links.push({ label: 'Desktop', path: `/Workspaces/${ws}/Desktop`, icon: 'fav-desktop.png' });
                links.push({ label: 'Pictures', path: `/Workspaces/${ws}/Pictures`, icon: 'fav-pictures.png' });
                links.push({ label: 'References', path: `/Workspaces/${ws}/References`, icon: 'fav-searches.png' });
                links.push({ label: 'Notes', path: `/Workspaces/${ws}/Notes`, icon: 'fav-documents.png' });
            }
            links.push({ label: 'Workspaces', path: '/Workspaces', icon: 'fav-public.png' });
            links.push({ label: 'Library', path: '/System/Cache', icon: 'fav-recent.png' });
            if (ws) links.push({ label: 'Trash', path: `/Workspaces/${ws}/Trash`, icon: 'fav-recycle.png' });
            return links;
        }

        renderFavorites() {
            const host = this.el.favorites;
            if (!host) return;
            host.innerHTML = this.favoriteLinks().map((l) => `
                <li><button type="button" class="explorer-favorite-link" data-path="${esc(l.path)}" title="${esc(l.label)}">
                    <img src="${ART}/${l.icon}" alt=""><span>${esc(l.label)}</span></button></li>`).join('');
            this.layoutFavorites();
            this.highlightFavorite();
        }

        highlightFavorite() {
            // the Phone group under Favorite Links follows the place too (explorerPhoneDrive.js)
            if (root.explorerPhoneDrive && root.explorerPhoneDrive.available()) root.explorerPhoneDrive.attach(this.app);
            const host = this.el.favorites;
            if (!host) return;
            const current = this.app.currentPath;
            host.querySelectorAll('.explorer-favorite-link').forEach((b) => {
                b.classList.toggle('is-current', b.dataset.path === current);
            });
        }

        toggleFolders() {
            const { folders, foldersBar, tree } = this.el;
            if (!folders) return;
            const open = !folders.classList.contains('is-open');
            folders.classList.toggle('is-open', open);
            if (foldersBar) foldersBar.setAttribute('aria-expanded', open ? 'true' : 'false');
            const nav = folders.closest('.explorer-nav-pane');
            if (nav) nav.classList.toggle('folders-open', open);
            this.layoutFavorites();
            if (open && tree) {
                if (!tree.childElementCount) this.renderTreeRoot();
                this.syncTree();
            }
        }

        /** Folders open: Vista's Favorite Links keeps three links and folds the rest into More ». */
        layoutFavorites() {
            const host = this.el.favorites;
            const more = this.el.favoritesMore;
            if (!host) return;
            const open = !!(this.el.folders && this.el.folders.classList.contains('is-open'));
            const links = [...host.querySelectorAll(':scope > li')];
            links.forEach((li, i) => li.classList.toggle('is-folded', open && i >= 3));
            if (more) more.classList.toggle('hidden', !open || links.length <= 3);
        }

        attachFavoritesMore() {
            const cm = root.contextMenu;
            const more = this.el.favoritesMore;
            if (!cm || !more) return;
            const items = this.favoriteLinks().slice(3).map((l) => ({ text: l.label, action: l.path, icon: 'fas fa-folder' }));
            cm.detachClickMenuFromElement(more);
            cm.attachClickMenuToElement(more, {
                sections: [{ type: 'list', items }],
                onAction: (path) => this.app.navigateTo(path)
            });
        }

        // ---- Folders tree ----
        // Vista's namespace tree (VM, Explorer's Folders pane): Desktop at the root, then the user's
        // folder, Public, Computer with its drives, Network, Control Panel and Recycle Bin, then the
        // folders on the desktop. Here the user's folder is the workspace; Workspaces is not a node
        // of its own (Yukimi): it stays where it is on Local Disk (C:), and every place under it opens
        // through Computer ▸ Local Disk (C:) ▸ Workspaces. The drives are Local Disk (C:) (the VFS
        // root) plus the phones and network drives Computer shows; Recycle Bin is the workspace's Trash. Folders load as they open; the tree
        // opens down to the folder on screen and marks it.

        workspaceId() {
            if (typeof root.activeWorkspace !== 'undefined' && root.activeWorkspace) return root.activeWorkspace;
            return typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        }

        treeIcon(name) {
            const icons = {
                desktop: ['tree-desktop-16.png', 'tree-desktop-32.png'],
                user: ['tree-user-16.png', 'tree-user-32.png'],
                public: ['fav-public.png'],
                computer: ['computer-16.png', 'tree-computer-32.png'],
                drive: ['drive-system-16.png', 'tree-drive-system-32.png'],
                removable: ['drive-removable-16.png'],
                fixed: ['drive-fixed-16.png'],
                device: ['portable-device-16.png', 'portable-device-32.png'],
                network: ['drive-network-16.png'],
                'network-off': ['drive-network-off-16.png'],
                'control-panel': ['tree-control-panel-16.png', 'tree-control-panel-32.png'],
                recycle: ['../vista-icons/explorer/recycle-16.png', '../vista-icons/explorer/recycle-32.png'],
                folder: ['../vista-icons/explorer/folder-16.png', '../vista-icons/explorer/folder-32.png']
            };
            const [one, two] = icons[name] || icons.folder;
            const srcset = two ? ` srcset="${ART}/${one} 1x, ${ART}/${two} 2x"` : '';
            return `<img class="explorer-tree-icon" src="${ART}/${one}"${srcset} alt="" draggable="false">`;
        }

        rootSpecs() {
            const ws = this.workspaceId();
            const computerPath = root.ExplorerComputerView ? root.ExplorerComputerView.PATH : null;
            const desktopPath = ws ? `/Workspaces/${ws}/Desktop` : null;
            const children = () => {
                const list = [];
                if (ws) {
                    const name = typeof root.getWorkspaceDisplayName === 'function' ? root.getWorkspaceDisplayName(ws)
                        : (typeof getWorkspaceDisplayName === 'function' ? getWorkspaceDisplayName(ws) : this.labelFor(`/Workspaces/${ws}`));
                    list.push({ label: name || ws, icon: 'user', path: `/Workspaces/${ws}`, folders: `/Workspaces/${ws}` });
                }
                if (computerPath && this.app.computer) {
                    list.push({ label: 'Computer', icon: 'computer', path: computerPath, children: () => this.computerSpecs() });
                }
                list.push({ label: 'Control Panel', icon: 'control-panel', leaf: true, action: () => this.openControlPanel() });
                if (ws) list.push({ label: 'Recycle Bin', icon: 'recycle', path: `/Workspaces/${ws}/Trash`, leaf: true });
                // the folders on the desktop follow, as Vista lists them under Desktop
                if (!desktopPath) return list;
                return this.folderSpecs(desktopPath).then((folders) => list.concat(folders), () => list);
            };
            if (!desktopPath) return [{ label: 'Desktop', icon: 'desktop', children, open: true }];
            return [{ label: 'Desktop', icon: 'desktop', path: desktopPath, children, open: true }];
        }

        /** Computer's drives in the order its window groups them: hard disk, removable, devices,
            network. The network drive's state is fetched first (explorerSequenzia.js), so Sequenzia is
            there the first time Computer opens in the tree. */
        async computerSpecs() {
            const view = this.app.computer;
            if (root.explorerSequenzia && typeof root.explorerSequenzia.refreshStatus === 'function') {
                try { await root.explorerSequenzia.refreshStatus(); } catch (_err) { /* listed without it */ }
            }
            const list = [{ label: rootLabel(), icon: 'drive', path: '/', folders: '/' }];
            if (!view) return list;
            const open = (key) => () => view.openDrive(key);
            // the phone's own drives inside the app; lettered on a hybrid phone's DeX window (#798: D: is
            // its internal storage, a hard disk; E:, F: ... cards and USB), drives before devices as in Vista
            (view.phoneDrives ? view.phoneDrives() : []).forEach((d) => {
                list.push({ label: d.letter ? `${d.name} (${d.letter}:)` : d.name, icon: d.hdd ? 'drive' : 'removable', path: d.path || null, leaf: true, action: open(d.key) });
            });
            // Portable Devices: each ActiveSync phone, opening to its storages (Computer ▸ <device>)
            (view.portableDevices ? view.portableDevices() : []).forEach((d) => {
                list.push({
                    label: d.name,
                    icon: 'device',
                    path: root.ExplorerComputerView.devicePath(d.deviceId),
                    leaf: !d.files,
                    children: () => this.deviceStorageSpecs(d.deviceId)
                });
            });
            (view.networkDrives ? view.networkDrives() : []).forEach((d) => {
                list.push({ label: d.name, icon: d.online ? 'network' : 'network-off', path: d.path || null, leaf: true, action: open(d.key) });
            });
            return list;
        }

        /** A device's storages for its tree node; the phone becomes the one phoneStorage shows. */
        async deviceStorageSpecs(deviceId) {
            const ps = root.phoneStorage;
            if (!ps || !ps.remote) return [];
            if (ps.deviceId !== deviceId) ps.select(deviceId);
            if (ps.deviceId !== deviceId) return [];
            try { await ps.hello(); } catch (_err) { return []; }
            const st = ps.deviceId === deviceId ? ps.state() : null;
            return (st && Array.isArray(st.roots) ? st.roots : []).map((r) => ({
                label: r.name || r.id,
                icon: r.kind === 'internal' ? 'fixed' : 'removable',
                path: `phone://${encodeURIComponent(r.id)}`,
                leaf: true
            }));
        }

        openControlPanel() {
            const loader = root.featureLoader;
            const ready = loader && typeof loader.loadFeature === 'function' ? loader.loadFeature('control_panel') : Promise.resolve();
            Promise.resolve(ready).then(() => {
                if (root.melatonControlPanel) root.melatonControlPanel.open('home');
            }).catch((err) => console.error('Control Panel', err));
        }

        /** The sub-folders of a VFS folder, as tree nodes that load their own when opened. */
        async folderSpecs(path) {
            const client = root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null);
            if (!client) return [];
            const result = await client.listDirectory(path, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc' });
            const base = path === '/' ? '' : path;
            return (result && result.items || []).filter((item) => this.app.isFolderItem(item)).map((item) => {
                // the applet resolves VFS folders against the folder on screen; the tree resolves
                // them against its own node
                let target = item.navPath || null;
                if (!target && item.targetKind === 'vfs-folder') target = `${base}/${item.targetId || item.id}`;
                if (!target && typeof this.app.resolveNavigationPath === 'function') target = this.app.resolveNavigationPath(item);
                if (!target) target = `${base}/${item.name}`;
                const label = item.name || target.split('/').pop();
                this.labels.set(target, label);
                const recycle = item.name === 'Trash' && /^\/Workspaces\/[^/]+\/Trash$/.test(target);
                return { label, icon: recycle ? 'recycle' : 'folder', path: target, folders: target };
            });
        }

        renderTreeRoot() {
            const tree = this.el.tree;
            if (!tree) return;
            this.treeSpecs = new WeakMap();
            tree.innerHTML = '';
            this.rootSpecs().forEach((spec) => tree.appendChild(this.treeNode(spec, 0)));
        }

        treeNode(spec, depth) {
            const li = document.createElement('li');
            li.className = 'explorer-tree-node';
            li.setAttribute('role', 'treeitem');
            if (spec.path) li.dataset.path = spec.path;
            const leaf = !!spec.leaf || (!spec.children && !spec.folders);
            li.classList.toggle('is-leaf', leaf);
            li.setAttribute('aria-expanded', 'false');
            li.innerHTML = `<div class="explorer-tree-row" style="--tree-depth:${depth}"><span class="explorer-tree-glyph" aria-hidden="true"></span><span class="explorer-tree-label" title="${esc(spec.label)}">${this.treeIcon(spec.icon)}<span class="explorer-tree-text">${esc(spec.label)}</span></span></div><ul class="explorer-tree-children" role="group"></ul>`;
            li.dataset.depth = String(depth);
            this.treeSpecs.set(li, spec);
            if (spec.open) this.expandTreeNode(li);
            return li;
        }

        /** Opens a node, loading its children the first time (again after it was closed, so new folders show). */
        expandTreeNode(li) {
            const spec = this.treeSpecs && this.treeSpecs.get(li);
            if (!spec || li.classList.contains('is-leaf')) return Promise.resolve();
            li.classList.add('is-open');
            li.setAttribute('aria-expanded', 'true');
            if (li._treeLoad) return li._treeLoad;
            const ul = li.querySelector(':scope > .explorer-tree-children');
            const depth = Number(li.dataset.depth || 0) + 1;
            const source = spec.children ? spec.children() : this.folderSpecs(spec.folders);
            const load = Promise.resolve(source).then((specs) => {
                // a newer load (the node listed again meanwhile) owns the children
                if (li._treeLoad !== load) return;
                ul.innerHTML = '';
                (specs || []).forEach((child) => ul.appendChild(this.treeNode(child, depth)));
                // Vista drops the glyph of a folder that turns out to be empty
                if (!ul.childElementCount) {
                    li.classList.add('is-leaf');
                    li.classList.remove('is-open');
                    li.setAttribute('aria-expanded', 'false');
                }
            }).catch((err) => {
                console.error('Cartograph folders', err);
                if (li._treeLoad === load) li._treeLoad = null;
            });
            li._treeLoad = load;
            return load;
        }

        collapseTreeNode(li) {
            li.classList.remove('is-open');
            li.setAttribute('aria-expanded', 'false');
            const spec = this.treeSpecs && this.treeSpecs.get(li);
            // folder nodes list again when reopened; Desktop and Computer keep their nodes
            if (spec && spec.folders) li._treeLoad = null;
        }

        toggleTreeNode(li, onlyOpen) {
            if (li.classList.contains('is-open')) {
                if (!onlyOpen) this.collapseTreeNode(li);
            } else {
                this.expandTreeNode(li);
            }
        }

        openTreeNode(li) {
            const spec = this.treeSpecs && this.treeSpecs.get(li);
            if (!spec) return;
            if (spec.action) spec.action();
            else if (spec.path) this.app.navigateTo(spec.path);
            else this.toggleTreeNode(li);
        }

        markTreeNode(li) {
            const tree = this.el.tree;
            if (!tree) return;
            tree.querySelectorAll('.explorer-tree-node.is-selected').forEach((n) => {
                if (n !== li) {
                    n.classList.remove('is-selected');
                    n.setAttribute('aria-selected', 'false');
                }
            });
            if (!li) return;
            li.classList.add('is-selected');
            li.setAttribute('aria-selected', 'true');
            // into view in the tree's own box, up and down only (scrollIntoView would also slide the
            // nav pane and the tree sideways, cutting the names off on the left)
            const row = li.querySelector(':scope > .explorer-tree-row');
            const box = tree.closest('.explorer-folders-tree');
            if (row && box) {
                const r = row.getBoundingClientRect();
                const b = box.getBoundingClientRect();
                if (r.top < b.top) box.scrollTop -= b.top - r.top;
                else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
            }
        }

        /** The nodes from Desktop down to a path, as Vista walks its namespace to the folder on screen. */
        treeChain(path) {
            const ws = this.workspaceId();
            const desktop = ws ? `/Workspaces/${ws}/Desktop` : null;
            const computer = root.ExplorerComputerView ? root.ExplorerComputerView.PATH : null;
            const prefixes = (from, p) => {
                const parts = String(p).split('/').filter(Boolean);
                const out = [];
                for (let i = from; i <= parts.length; i++) out.push('/' + parts.slice(0, i).join('/'));
                return out;
            };
            const head = desktop ? [desktop] : [];
            if (!path) return head;
            if (path === desktop) return head;
            if (computer && path === computer) return head.concat(computer);
            const view = root.ExplorerComputerView;
            if (view && view.deviceIdOf(path)) return head.concat(computer, path);
            if (root.explorerPhoneDrive && root.explorerPhoneDrive.isPath(path)) {
                // a remote phone's storage: Computer ▸ <device> ▸ <storage> (the storage node is the deepest)
                const ps = root.phoneStorage;
                const m = String(path).match(/^phone:\/\/([^/]+)/);
                if (ps && ps.remote && ps.deviceId && view && m) return head.concat(computer, view.devicePath(ps.deviceId), `phone://${m[1]}`);
                return computer ? head.concat(computer) : head;
            }
            if (root.explorerSequenzia && root.explorerSequenzia.isPath(path)) {
                return head.concat(computer ? [computer] : [], prefixes(String(root.explorerSequenzia.ROOT).split('/').filter(Boolean).length, path));
            }
            return head.concat(computer ? [computer] : [], prefixes(0, path));
        }

        /** Opens the tree down to the folder on screen and marks it (Folders open only). */
        async syncTree() {
            const { tree, folders } = this.el;
            if (!tree || !folders || !folders.classList.contains('is-open')) return;
            if (!tree.childElementCount) this.renderTreeRoot();
            const token = (this._treeSync = (this._treeSync || 0) + 1);
            const chain = this.treeChain(this.app.currentPath);
            let node = null;
            let level = tree;
            for (let i = 0; i < chain.length; i++) {
                const next = [...level.children].find((li) => li.dataset.path === chain[i]);
                if (!next) break;
                node = next;
                if (i < chain.length - 1) {
                    await this.expandTreeNode(node);
                    if (token !== this._treeSync) return;
                    level = node.querySelector(':scope > .explorer-tree-children');
                }
            }
            if (token !== this._treeSync) return;
            const here = node && node.dataset.path === this.app.currentPath ? node : null;
            this.markTreeNode(here);
            // Vista opens the folder on screen too, showing what is inside it
            if (here && here.dataset.depth !== '0') this.expandTreeNode(here);
        }

        // ---- details pane ----

        // Same picture must not be torn down and fetched again. Status refreshes call this
        // constantly; a new element each time flashes the file icon, then the photo, per tile.
        _detailsIconKey(item) {
            return [
                item.id || '',
                item.targetKind || '',
                item.shortcutType || '',
                item.previewUrl || '',
                item.galleryPreview || '',
                item.previewImageFilename || '',
                item.previewHash || '',
                item.modifiedAt || ''
            ].join('\n');
        }

        renderDetails(selected, summaryText) {
            const { detailsIcon, detailsInfo } = this.el;
            if (!detailsIcon || !detailsInfo) return;
            const sel = Array.isArray(selected) ? selected : [];
            const row = (label, value) => (value
                ? `<div class="explorer-details-row"><span class="explorer-details-label">${esc(label)}:</span><span class="explorer-details-value">${esc(value)}</span></div>`
                : '');
            if (sel.length === 1) {
                const item = sel[0];
                const key = this._detailsIconKey(item);
                if (detailsIcon.dataset.detailsKey !== key) {
                    // has-preview stays so the previous photo remains until the next one is decoded
                    // (_populatePreviewIconBox in explorerApplet.js swaps it in place)
                    const keepPreview = detailsIcon.classList.contains('has-preview');
                    detailsIcon.dataset.detailsKey = key;
                    detailsIcon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                    if (keepPreview) detailsIcon.classList.add('has-preview');
                    if (typeof this.app._populateIconBox === 'function') this.app._populateIconBox(detailsIcon, item);
                }
                // a contact shows its name and no type (Vista's Contacts folder)
                const contactName = root.explorerContacts ? root.explorerContacts.detailsName(this.app, item) : null;
                const type = contactName != null ? '' : this.typeLabel(item);
                const date = this.formatDate(item.modifiedAt);
                const size = this.app._itemSizeBytes && this.app._itemSizeBytes(item)
                    ? this.app._formatStatusSize(this.app._itemSizeBytes(item)) : '';
                detailsInfo.innerHTML = `<div class="explorer-details-name">${esc(contactName != null ? contactName : (item.name || ''))}</div>`
                    + (type ? `<div class="explorer-details-type">${esc(type)}</div>` : '')
                    + row('Date modified', date) + row('Size', size);
                return;
            }
            // no selection or several: the folder's icon and the summary line
            const inContacts = !!(root.explorerContacts && root.explorerContacts.active(this.app));
            const folderKey = inContacts ? 'contacts' : '';
            if (detailsIcon.dataset.detailsKey !== folderKey) {
                detailsIcon.dataset.detailsKey = folderKey;
                detailsIcon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                detailsIcon.innerHTML = inContacts
                    ? `<img class="explorer-contacts-folder-icon" src="${root.explorerContacts.ART}/folder-48.png" alt="">`
                    : '<i class="fas fa-folder explorer-item-type-icon" data-kind="folder"></i>';
            }
            detailsInfo.innerHTML = `<div class="explorer-details-summary">${esc(summaryText || '')}</div>`;
        }
    }

    root.ExplorerVistaChrome = ExplorerVistaChrome;
})(typeof window !== 'undefined' ? window : globalThis);
