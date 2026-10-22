// Games Explorer, as Windows Vista's Games folder (Yozora #609): an Explorer window over the games
// (the Start menu's Games place and All Programs > Games > Games Explorer open it). Measured on
// the VM (800x600 window): no navigation pane; column headers Name, Last played, Product version,
// Publisher, Developer, Rating; Large Icons; the preview pane on the right (the trophy and the
// Performance Information note, or the selected game's icon, name, recommended / required ratings
// and the ESRB box); the details pane at the bottom ("9 items", or the game's Publisher, Developer,
// Product version, Genre). Selecting a game adds Play and Community and Support to the command bar.
// Each game's facts come from its own Game Definition File (Minesweeper.exe.mui DATA __GDF_XML, in
// the game's data.json as mui.gdf); the strings and icons from gameux.dll.
(function (root) {
    'use strict';

    const VG = root.VistaGames;
    const MODAL_ID = 'vistaGamesExplorerModal';
    const ART = '/static_images/vista-games/explorer/';
    const VISTA_ART = '/static_images/vista-explorer/';

    // the nine games Vista ships, in the Games folder's order; their packs carry the GDF
    const CATALOG = [
        { id: 'chess', pack: 'chess', name: 'Chess Titans' },
        { id: 'freecell', pack: 'freecell', name: 'FreeCell' },
        { id: 'hearts', pack: 'hearts', name: 'Hearts' },
        { id: 'inkball', pack: 'inkball', name: 'InkBall' },
        { id: 'mahjong', pack: 'mahjong', name: 'Mahjong Titans' },
        { id: 'minesweeper', pack: 'minesweeper', name: 'Minesweeper' },
        { id: 'purble', pack: 'purble', name: 'Purble Place' },
        { id: 'solitaire', pack: 'solitaire', name: 'Solitaire' },
        { id: 'spider', pack: 'spider', name: 'Spider Solitaire' },
        // the two Melaton additions: no GDF in a pack, so their facts are written here in the
        // GDF's terms (Minesweeper's ratings, as small Direct3D games on the same engine)
        {
            id: 'blockdrop',
            pack: null,
            name: 'Block Drop',
            gdf: {
                description: 'The object of Block Drop is to fit the falling blocks together into solid rows. A '
                    + 'full row disappears; clear 150 rows to win. If the blocks stack up to the top, the game is over.',
                genre: 'Family Entertainment',
                developer: 'Academy City Research P.S.R.',
                publisher: 'Melaton',
                version: '6.0.6002.18005',
                minimum: '1',
                recommended: '2'
            }
        },
        {
            id: 'brickbreaker',
            pack: null,
            name: 'Brick Breaker',
            gdf: {
                description: 'The object of Brick Breaker is to clear every brick with the ball. Bounce the ball off '
                    + 'your paddle and catch the capsules that fall from broken bricks. Clear all 20 levels to win.',
                genre: 'Family Entertainment',
                developer: 'Academy City Research P.S.R.',
                publisher: 'Melaton',
                version: '6.0.6002.18005',
                minimum: '1',
                recommended: '2'
            }
        }
    ];

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    // the 2x copy beside a 1x glyph (scripts/build-vista-games-hidpi.sh)
    const x2 = (url) => url.replace(/\.png$/, '@2x.png');

    const iconUrl = (id, size) => '/static_images/app_icons/' + size + '/vista-' + id + '.webp';

    let gx = null;

    class GamesExplorer {
        constructor() {
            this.games = [];
            this.selected = null;
            this.view = 'large';
            this.build();
        }

        build() {
            const modal = el('div', 'modal resizeable-window toolbar-visible vista-games-explorer hidden');
            modal.id = MODAL_ID;
            modal.dataset.windowIdentifier = MODAL_ID;
            modal.dataset.windowDefaultWidth = '800';
            modal.dataset.windowDefaultHeight = '600';
            modal.dataset.windowMinWidth = '480';
            modal.dataset.windowMinHeight = '360';
            // the Explorer title row is Control Panel's (melatonControlPanel.js markup; vista-explorer.css
            // styles both windows): travel orbs, Recent Pages, the address with its crumb, refresh, Search
            modal.innerHTML = `
                <div class="modal-window-title">
                    <div class="modal-window-title-main">
                        <i class="fas fa-trophy icon-fa"></i>
                        <img src="/static_images/app_icons/24/vista-games.webp" srcset="/static_images/app_icons/24/vista-games.webp 1x, /static_images/app_icons/48/vista-games.webp 2x" alt="" class="icon-image">
                        <span class="cpl-window-title">Games</span>
                    </div>
                    <div class="modal-window-title-toolbar">
                        <div class="button-group naxt-nav-group">
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-back" title="Back" disabled><i class="fas fa-arrow-left"></i></button>
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-forward" title="Forward" disabled><i class="fas fa-arrow-right"></i></button>
                            <button type="button" class="btn-secondary toolbar-input-segment explorer-recent-pages-btn cpl-recent" title="Recent Pages" aria-label="Recent Pages" disabled></button>
                        </div>
                        <div class="button-group cpl-address-group">
                            <div class="form-control colored toolbar-input-segment cpl-address" role="navigation" aria-label="Address"><i class="fas fa-trophy cpl-address-icon" aria-hidden="true"></i><span class="cpl-crumb-sep" aria-hidden="true">&#9656;</span><button type="button" class="cpl-crumb">Games</button></div>
                            <button type="button" class="btn-secondary toolbar-input-segment cpl-refresh" title="Refresh"><i class="fas fa-sync"></i></button>
                        </div>
                        <div class="button-group">
                            <input type="text" class="form-control colored toolbar-input-segment cpl-search" placeholder="Search" spellcheck="false" autocapitalize="off" autocorrect="off">
                        </div>
                    </div>
                </div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>`;
            const controls = modal.querySelector('.modal-window-controls');
            const content = el('div', 'modal-content win7 gx-content');
            this.commandBar = el('div', 'gx-commandbar');
            content.appendChild(this.commandBar);
            const body = el('div', 'gx-body');
            const list = el('div', 'gx-list');
            const header = el('div', 'gx-columns');
            ['Name', 'Last played', 'Product version', 'Publisher', 'Developer', 'Rating'].forEach((h, i) => {
                const c = el('div', 'gx-column' + (i === 0 ? ' sorted' : ''), h);
                header.appendChild(c);
            });
            header.appendChild(el('div', 'gx-column-more', '»'));
            this.grid = el('div', 'gx-grid');
            list.appendChild(header);
            list.appendChild(this.grid);
            this.preview = el('div', 'gx-preview');
            body.appendChild(list);
            body.appendChild(this.preview);
            content.appendChild(body);
            this.details = el('div', 'gx-details');
            content.appendChild(this.details);

            modal.appendChild(content);
            document.body.appendChild(modal);
            this.modal = modal;

            controls.querySelector('.close-btn').addEventListener('click', () => closeModal(modal));
            this.grid.addEventListener('click', (e) => {
                const item = e.target.closest('.gx-item');
                this.select(item ? this.games.find((g) => g.id === item.dataset.id) : null);
            });
            this.grid.addEventListener('dblclick', (e) => {
                const item = e.target.closest('.gx-item');
                if (item) this.play(this.games.find((g) => g.id === item.dataset.id));
            });
            this.grid.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.selected) this.play(this.selected);
            });
            this.grid.tabIndex = 0;
            const search = modal.querySelector('.cpl-search');
            modal.querySelector('.cpl-refresh').addEventListener('click', () => this.load());
            search.addEventListener('input', () => this.renderGrid(search.value.trim().toLowerCase()));
        }

        // the games and their GDF facts (the Vista nine, then any other registered game)
        load() {
            const extra = VG.list().filter((r) => !r.hidden && !CATALOG.some((c) => c.id === r.id)).map((r) => ({ id: r.id, pack: null, name: r.name, icon: r.icon }));
            const all = CATALOG.concat(extra);
            return Promise.all(all.map((g) => (g.pack ? fetch('/static_images/vista-games/' + g.pack + '/data.json').then((r) => r.json()).catch(() => null) : Promise.resolve(null)).then((data) => {
                const gdf = data && data.mui && data.mui.gdf && data.mui.gdf.c ? data.mui.gdf.c[0] : null;
                const txt = (tag) => VG.text(gdf, tag, '');
                const nested = (tag, sub) => VG.text(VG.child(VG.child(gdf, tag), sub), undefined, '');
                const perf = VG.child(gdf, 'WindowsSystemPerformanceRating');
                if (g.gdf) return Object.assign({}, g, g.gdf, { rated: true });
                return Object.assign({}, g, {
                    name: (gdf && txt('Name')) || g.name,
                    description: gdf ? txt('Description') : '',
                    genre: gdf ? nested('Genres', 'Genre') : 'Family Entertainment',
                    developer: gdf ? nested('Developers', 'Developer') : 'Melaton',
                    publisher: gdf ? nested('Publishers', 'Publisher') : 'Melaton',
                    version: gdf ? '6.0.6002.18005' : '',
                    minimum: perf && perf.a ? perf.a.minimum : '',
                    recommended: perf && perf.a ? perf.a.recommended : '',
                    rated: !!gdf
                });
            }))).then((games) => {
                this.games = games;
                this.renderGrid('');
                this.select(null);
            });
        }

        renderGrid(filter) {
            this.grid.textContent = '';
            this.grid.dataset.view = this.view;
            const size = this.view === 'medium' ? 48 : 96;
            this.games.filter((g) => !filter || g.name.toLowerCase().includes(filter)).forEach((g) => {
                const item = el('div', 'gx-item' + (this.selected && this.selected.id === g.id ? ' selected' : ''));
                item.dataset.id = g.id;
                // the GDF description is the item's infotip
                if (g.description) item.title = g.description;
                const icon = el('img');
                icon.alt = '';
                icon.src = iconUrl(g.id, size);
                icon.srcset = iconUrl(g.id, size) + ' 1x, ' + iconUrl(g.id, size * 2 > 384 ? 384 : size * 2) + ' 2x';
                icon.onerror = () => { icon.src = g.icon ? g.icon + '-48.png' : ART + 'games-48.png'; };
                item.appendChild(icon);
                item.appendChild(el('span', 'gx-item-name', g.name));
                this.grid.appendChild(item);
            });
            this.renderDetails();
        }

        select(game) {
            this.selected = game || null;
            this.grid.querySelectorAll('.gx-item').forEach((n) => n.classList.toggle('selected', !!game && n.dataset.id === game.id));
            this.renderCommands();
            this.renderPreview();
            this.renderDetails();
        }

        commandButton(label, icon, opts) {
            const b = el('button', 'gx-command' + (opts && opts.menu ? ' has-menu' : ''));
            b.type = 'button';
            if (icon) {
                const i = el('img');
                i.alt = '';
                i.src = icon;
                i.srcset = icon + ' 1x, ' + x2(icon) + ' 2x';
                b.appendChild(i);
            }
            b.appendChild(el('span', '', label));
            if (opts && opts.menu) b.appendChild(el('span', 'gx-command-glyph'));
            if (opts && opts.title) b.title = opts.title;
            if (opts && opts.click) b.addEventListener('click', opts.click);
            if (opts && opts.menu && typeof contextMenu !== 'undefined' && contextMenu) {
                // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
                contextMenu.attachClickMenuToElement(b, {
                    onAction: (action) => opts.onAction && opts.onAction(action),
                    sections: [{ type: 'list', initfn: (section) => { section.items = opts.menu(); } }]
                });
            }
            this.commandBar.appendChild(b);
            return b;
        }

        renderCommands() {
            this.commandBar.textContent = '';
            const g = this.selected;
            this.commandButton('Organize', VISTA_ART + 'organize.png', {
                menu: () => [{ text: 'Layout', disabled: true }, { separator: true }, { text: 'Properties', action: 'properties', disabled: !g }],
                onAction: () => {}
            });
            this.commandButton('Views', VISTA_ART + 'views.png', {
                menu: () => [
                    { text: 'Large Icons', action: 'large', checked: this.view === 'large', showIndicator: true, indicatorMark: 'radio' },
                    { text: 'Medium Icons', action: 'medium', checked: this.view === 'medium', showIndicator: true, indicatorMark: 'radio' },
                    { text: 'Details', action: 'details', checked: this.view === 'details', showIndicator: true, indicatorMark: 'radio' }
                ],
                onAction: (v) => {
                    this.view = v;
                    this.renderGrid('');
                }
            });
            if (g) {
                this.commandButton('Play', ART + 'gameux-3-16.png', {
                    title: 'Play the game or select other play options',
                    menu: () => [{ text: 'Play', action: 'play' }],
                    onAction: () => this.play(g)
                });
                this.commandButton('Community and Support', ART + 'gameux-8-16.png', {
                    title: 'Visit websites to get more information about the game',
                    menu: () => [{ text: 'Home Page', disabled: true }, { text: 'Support', disabled: true }],
                    onAction: () => {}
                });
            }
            this.commandButton('Options', ART + 'options-16.png', { title: 'Set up Games folder options', click: () => this.showOptions() });
            this.commandButton('Tools', ART + 'tools-16.png', {
                title: 'Access game-related tools',
                menu: () => [
                    { text: 'Hardware', action: 'cpl' }, { text: 'Display Devices', action: 'cpl' }, { text: 'Input Devices', action: 'cpl' },
                    { text: 'Audio Devices', action: 'cpl' }, { text: 'Firewall', action: 'cpl' }, { text: 'Programs and Features', action: 'cpl' },
                    { separator: true }, { text: 'Performance Information and Tools', action: 'cpl' }, { separator: true }, { text: 'Customize...', disabled: true }
                ],
                onAction: () => this.openControlPanel()
            });
            this.commandButton('Parental Controls', ART + 'parental-16.png', { title: 'Set up Parental Controls', click: () => this.openControlPanel('users') });
            const help = el('button', 'gx-help');
            help.type = 'button';
            help.title = 'Get help';
            help.innerHTML = '<img src="' + VISTA_ART + 'help.png" srcset="' + VISTA_ART + 'help.png 1x, ' + x2(VISTA_ART + 'help.png') + ' 2x" alt="">';
            this.commandBar.appendChild(help);
        }

        renderPreview() {
            const p = this.preview;
            const g = this.selected;
            p.textContent = '';
            if (!g) {
                const icon = el('img', 'gx-preview-icon');
                icon.alt = '';
                icon.src = iconUrl('games', 128);
                icon.srcset = iconUrl('games', 128) + ' 1x, ' + iconUrl('games', 384) + ' 2x';
                p.appendChild(icon);
                const note = el('div', 'gx-preview-perf');
                note.innerHTML = '<div class="gx-link">View your computer\'s Performance Information:</div>'
                    + '<div>This computer\'s Performance Information is not created.</div>'
                    + '<div>Create Performance Information for your computer with <a class="gx-link-u">Performance Information and Tools</a>.</div>';
                p.appendChild(note);
                return;
            }
            const icon = el('img', 'gx-preview-icon');
            icon.alt = '';
            icon.src = iconUrl(g.id, 128);
            icon.srcset = iconUrl(g.id, 128) + ' 1x, ' + iconUrl(g.id, 384) + ' 2x';
            p.appendChild(icon);
            p.appendChild(el('div', 'gx-preview-name', g.name));
            if (g.rated) {
                const perf = el('div', 'gx-preview-ratings');
                perf.innerHTML = '<div class="gx-link">Check how well this game will perform on your computer:</div>'
                    + '<div class="gx-rating-row"><span>Game recommended rating:</span><span class="gx-badge">' + Number(g.recommended).toFixed(1) + '</span></div>'
                    + '<div class="gx-rating-row"><span>Game required rating:</span><span class="gx-badge">' + Number(g.minimum).toFixed(1) + '</span></div>'
                    + '<div>This computer\'s Performance Information is not created.</div>'
                    + '<div>Create Performance Information for your computer with <a class="gx-link-u">Performance Information and Tools</a>.</div>'
                    + '<div class="gx-esrb"><img src="' + ART + 'esrb-everyone.png" srcset="' + ART + 'esrb-everyone.png 1x, ' + x2(ART + 'esrb-everyone.png') + ' 2x" alt=""><span>EVERYONE</span></div>';
                p.appendChild(perf);
            }
        }

        renderDetails() {
            const d = this.details;
            const g = this.selected;
            d.textContent = '';
            const icon = el('img', 'gx-details-icon');
            icon.alt = '';
            if (!g) {
                icon.src = iconUrl('games', 48);
                icon.srcset = iconUrl('games', 48) + ' 1x, ' + iconUrl('games', 96) + ' 2x';
                d.appendChild(icon);
                d.appendChild(el('div', 'gx-details-count', this.games.length + ' items'));
                return;
            }
            icon.src = iconUrl(g.id, 48);
            icon.srcset = iconUrl(g.id, 48) + ' 1x, ' + iconUrl(g.id, 96) + ' 2x';
            d.appendChild(icon);
            const grid = el('div', 'gx-details-grid');
            const cell = (cls, text) => grid.appendChild(el('div', cls, text));
            cell('gx-details-name', g.name);
            cell('gx-k', 'Publisher:');
            cell('gx-v gx-link-u', g.publisher);
            cell('gx-k gx-k2', 'Genre:');
            cell('gx-v', g.genre);
            // the name spans the first column; Developer and Product version take the next rows
            cell('gx-k', 'Developer:');
            cell('gx-v gx-link-u', g.developer);
            cell('', '');
            cell('', '');
            cell('gx-k', 'Product version:');
            cell('gx-v', g.version);
            d.appendChild(grid);
        }

        play(g) {
            if (!g) return;
            // openVistaGame: public/scripts/comp/featureLoader.js
            if (typeof openVistaGame === 'function') openVistaGame(g.id).catch((err) => console.warn('Games Explorer:', err));
        }

        openControlPanel(page) {
            if (typeof root.featureLoader === 'undefined') return;
            root.featureLoader.loadFeature('control_panel').then(() => {
                // melatonControlPanel.open: public/scripts/comp/melatonControlPanel.js
                if (root.melatonControlPanel) root.melatonControlPanel.open(page || 'home');
            });
        }

        // Options: gameux's "Set up Games folder options", a DirectUI page (gameux.dll UIFILE 113)
        // under a main instruction, with an OK / Cancel footer. Laid out from the VM's
        // (~/.cache/vista-vm/games-ref/gx-options.png): 556 x 362 client, 9 pt Segoe UI.
        showOptions() {
            const store = VG.store('gamesExplorer');
            const title = 'Set up Games folder options';
            const dlg = VG.dialog({ mui: { dialogs: {} } }, { cx: 0, cy: 0, controls: [], title }, {
                title,
                onCommand: (id) => {
                    if (id === 1) {
                        store.set('download', dlg.checked(101));
                        store.set('recent', dlg.checked(102));
                    }
                    return id === 1 || id === 2;
                }
            });
            dlg.modal.classList.add('vista-gx-options');
            const c = dlg.content;
            c.style.width = '556px';
            c.style.height = '362px';
            const node = (tag, cls, text) => {
                const n = el(tag, cls);
                if (text) VG.mnemonicText(n, text);
                return n;
            };
            const page = node('div', 'gxo-page');
            const icon = node('img', 'gxo-icon');
            icon.alt = '';
            icon.src = ART + 'options-32.png';
            page.appendChild(icon);
            page.appendChild(node('div', 'gxo-instruction', title));
            page.appendChild(node('div', 'gxo-text', 'Windows can provide additional information about the games installed on your computer by downloading information from the Internet.'));
            page.appendChild(node('div', 'gxo-label', 'Games folder options'));
            const group = node('div', 'gxo-group');
            const check = (id, text, on) => {
                const row = node('div', 'vista-game-choice gxo-check');
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.id = dlg.modal.id + '-' + id;
                input.checked = on;
                const label = document.createElement('label');
                label.htmlFor = input.id;
                const span = node('span', '', text);
                label.appendChild(span);
                if (span.dataset.mnemonic) label.dataset.mnemonic = span.dataset.mnemonic;
                row.appendChild(input);
                row.appendChild(label);
                row.input = input;
                dlg.controls[id] = row;
                group.appendChild(row);
            };
            const button = (id, text, parent, cls) => {
                const b = node('button', 'vista-game-button' + (cls ? ' ' + cls : ''), text);
                b.type = 'button';
                b.addEventListener('click', () => dlg.command(id));
                dlg.controls[id] = b;
                parent.appendChild(b);
                return b;
            };
            check(101, '&Download information about installed games', store.get('download', true));
            check(102, '&List most recently played games', store.get('recent', true));
            button(103, '&Clear history', group, 'gxo-push');
            // no hidden games to bring back
            button(104, '&Unhide games', group, 'gxo-push').disabled = true;
            page.appendChild(group);
            page.appendChild(node('div', 'gxo-privacy', 'We do not collect information that can be used to contact you.'));
            const link = node('button', 'gxo-link', 'Read the Privacy Statement online');
            link.type = 'button';
            page.appendChild(link);
            c.appendChild(page);
            const footer = node('div', 'gxo-footer');
            const ok = button(1, 'OK', footer, 'default');
            ok.dataset.dialogPrimary = '1';
            button(2, 'Cancel', footer);
            c.appendChild(footer);
            VG.centerOver(dlg.modal, this.modal);
            try { ok.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }

        open() {
            // openModal / bringModalToFront: public/scripts/comp/modalUtils.js
            if (this.modal.classList.contains('minimised') && typeof restoreMinimizedModal === 'function') restoreMinimizedModal(this.modal);
            if (this.modal.classList.contains('hidden')) openModal(this.modal);
            bringModalToFront(this.modal);
            return this.load();
        }
    }

    function open() {
        if (!gx) gx = new GamesExplorer();
        return gx.open().then(() => gx);
    }

    VG.register({ id: 'explorer', name: 'Games Explorer', hidden: true, feature: 'vista_explorer', open });
    root.openVistaGamesExplorer = open;
})(typeof window !== 'undefined' ? window : globalThis);
