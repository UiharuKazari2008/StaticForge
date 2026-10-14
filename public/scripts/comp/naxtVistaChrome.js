/**
 * Atelier on the Vista desktop (Yukimi 2026-10-13): a light Vista window with a menu bar (Vista's:
 * Explorer's menu bar on the VM, styles in public/css/vista-atelier.css) under the caption.
 *
 *   File      Home, Refresh, Add Custom Tag…, Close
 *   View      GOAT, Hidden Gems, Debated (the quick filters), Filter Bar, Reset Filters
 *
 * File and View drive the window's own buttons. On the Vista desktop those buttons leave the
 * caption for a blue command bar under the menu bar (Yukimi 2026-10-14: "Atelier should use a
 * blue control bar instead of the caption bar design"), Windows Mail's / Photo Gallery's, with
 * labels; the dataset + search + refresh group goes to the menu band's right end as the search
 * box. The elements move (listeners and the dropdowns stay theirs) and go back to the caption
 * off the Vista desktop (classic theme, no desktop), where the menu bar and light client go too.
 */
(function (root) {
    'use strict';

    // buttons that become menu-bar titles on the Vista desktop (Yukimi 2026-10-14: "too many items,
    // we should keep the home, filters and marks in the menu bar", then "move pins to the menu bar
    // as well"); the rest go to the command bar
    // Filters is not one of them: View already has Filter Bar and Reset Filters (Yukimi), so its
    // caption button is hidden on the Vista desktop (vista-atelier.css) and View drives it
    const MOVED = [['naxtHomeBtn', 'Home'], ['naxtMarkFilterDropdownBtn', 'Marks'], ['naxtElevatePinsDropdownBtn', 'Pins']];

    // command bar labels (Vista only; naxt-cmd-label is hidden elsewhere)
    const COMMAND_LABELS = {
        naxtQuickGoatBtn: 'GOAT',
        naxtQuickGemsBtn: 'Hidden Gems',
        naxtQuickDebatedBtn: 'Debated',
        naxtBagDropdownBtn: 'Tag Bag',
        naxtOpenCustomTagBtn: 'Add Tag'
    };

    class NaxtVistaChrome {
        constructor(app) {
            this.app = app;
            this.modal = app.modal;
            this.content = this.modal.querySelector('.modal-content');
            this.homes = new Map();
            this.toolbarHomes = [];
            this.build();
            this.wire();
            this.place();
        }

        isOn() {
            const b = document.body;
            return !!b && b.classList.contains('desktop-mode') && !b.classList.contains('windows-classic-theme');
        }

        build() {
            this.bar = document.createElement('div');
            this.bar.className = 'naxt-menubar';
            this.bar.setAttribute('role', 'menubar');
            this.bar.innerHTML = '<button type="button" class="naxt-menu-title" id="naxtMenuFile" role="menuitem">File</button>'
                + '<button type="button" class="naxt-menu-title" id="naxtMenuView" role="menuitem">View</button>';
            this.fileBtn = this.bar.querySelector('#naxtMenuFile');
            this.viewBtn = this.bar.querySelector('#naxtMenuView');
            MOVED.forEach(([id, label]) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                this.homes.set(btn, { parent: btn.parentNode, next: btn.nextSibling });
                if (!btn.querySelector('.naxt-menu-label')) {
                    const span = document.createElement('span');
                    span.className = 'naxt-menu-label';
                    span.textContent = label;
                    btn.appendChild(span);
                }
            });
            if (this.content) this.content.prepend(this.bar);

            this.commandBar = document.createElement('div');
            this.commandBar.className = 'naxt-command-bar';
            this.commandBar.setAttribute('role', 'toolbar');
            this.bar.after(this.commandBar);
            this.searchSlot = document.createElement('div');
            this.searchSlot.className = 'naxt-menubar-search';
            this.bar.appendChild(this.searchSlot);

            Object.keys(COMMAND_LABELS).forEach((id) => {
                const btn = document.getElementById(id);
                if (!btn || btn.querySelector('.naxt-cmd-label')) return;
                const span = document.createElement('span');
                span.className = 'naxt-cmd-label';
                span.textContent = COMMAND_LABELS[id];
                btn.appendChild(span);
            });
        }

        /** The caption toolbar's controls into the command bar (search group into the menu band; the
         *  gallery picker out of the search group as the bar's first button, Yukimi 2026-10-14:
         *  "the gallery selection should be its own button in the control bar"). */
        moveToolbar(on) {
            const toolbar = this.modal.querySelector('.modal-window-title .modal-window-title-toolbar');
            const dataset = document.getElementById('naxtDatasetDropdownBtn');
            if (on) {
                if (!toolbar || this.toolbarHomes.length) return;
                [...toolbar.children].forEach((child) => {
                    this.toolbarHomes.push(child);
                    const isSearch = !!child.querySelector('#naxtSearchInput');
                    (isSearch ? this.searchSlot : this.commandBar).appendChild(child);
                });
                if (dataset) {
                    this.datasetHome = dataset.parentNode;
                    this.commandBar.prepend(dataset);
                    this.labelDataset(dataset);
                }
                this.modal.classList.remove('toolbar-visible');
                return;
            }
            if (!toolbar || !this.toolbarHomes.length) return;
            if (dataset && this.datasetHome) this.datasetHome.prepend(dataset);
            this.datasetHome = null;
            this.toolbarHomes.forEach((child) => toolbar.appendChild(child));
            this.toolbarHomes = [];
            this.modal.classList.add('toolbar-visible');
        }

        /** The gallery button names the open gallery (naxtApplet keeps it in the button's title). */
        labelDataset(btn) {
            let label = btn.querySelector('.naxt-cmd-label');
            if (!label) {
                label = document.createElement('span');
                label.className = 'naxt-cmd-label';
                btn.appendChild(label);
                const chevron = document.createElement('span');
                chevron.className = 'naxt-cmd-chevron';
                chevron.setAttribute('aria-hidden', 'true');
                btn.appendChild(chevron);
            }
            const sync = () => { label.textContent = btn.title || 'Gallery'; };
            sync();
            if (!this.datasetObserver) {
                this.datasetObserver = new MutationObserver(sync);
                this.datasetObserver.observe(btn, { attributes: true, attributeFilter: ['title'] });
            }
        }

        /** Into the menu bar on the Vista desktop, back to the caption elsewhere. */
        place() {
            const on = this.isOn();
            if (this._placed === on) return;
            this._placed = on;
            this.modal.classList.toggle('naxt-vista', on);
            this.moveToolbar(on);
            if (on) {
                this.modal.dataset.windowClient = 'light';
                if (this.content) this.content.classList.add('win7');
                this.homes.forEach((_home, btn) => {
                    btn.classList.add('naxt-menu-title');
                    btn.setAttribute('role', 'menuitem');
                    // after File / View, before the search box at the band's right end
                    this.bar.insertBefore(btn, this.searchSlot);
                });
                return;
            }
            delete this.modal.dataset.windowClient;
            if (this.content) this.content.classList.remove('win7');
            // last first: each button's old neighbour is often the next moved one. Buttons that were
            // caption toolbar children are already back in order (moveToolbar); re-inserting them
            // before their recorded next sibling (a whitespace text node) would move them to the front.
            [...this.homes].reverse().forEach(([btn, home]) => {
                btn.classList.remove('naxt-menu-title');
                btn.removeAttribute('role');
                if (btn.parentNode === home.parent) return;
                home.parent.insertBefore(btn, home.next && home.next.parentNode === home.parent ? home.next : null);
            });
        }

        wire() {
            const cm = root.contextMenu;
            if (cm) {
                const lazy = (btn, build) => {
                    const attach = () => {
                        cm.detachClickMenuFromElement(btn);
                        cm.attachClickMenuToElement(btn, {
                            sections: [{ type: 'list', items: build() }],
                            onAction: (action) => this.run(action)
                        });
                    };
                    btn.addEventListener('pointerdown', attach, true);
                    btn.addEventListener('focus', attach);
                    attach();
                };
                lazy(this.fileBtn, () => this.fileItems());
                lazy(this.viewBtn, () => this.viewItems());
            }
            this.bodyObserver = new MutationObserver(() => this.place());
            this.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        live(btn) {
            return !!btn && !btn.disabled && !btn.classList.contains('hidden');
        }

        on(btn) {
            return !!btn && btn.dataset.state === 'on';
        }

        fileItems() {
            const a = this.app;
            return [
                { text: 'Home', icon: 'fas fa-home', action: 'home' },
                { text: 'Refresh', icon: 'fas fa-sync', action: 'refresh' },
                { separator: true },
                { text: 'Add Custom Tag…', icon: 'fas fa-plus', action: 'custom', disabled: !this.live(a.openCustomTagBtn) },
                { separator: true },
                { text: 'Close', action: 'close' }
            ];
        }

        viewItems() {
            const a = this.app;
            const check = (text, action, btn) => ({ text, action, indicatorStyle: 'box', checked: this.on(btn) });
            return [
                check('GOAT', 'goat', a.quickGoatBtn),
                check('Hidden Gems', 'gems', a.quickGemsBtn),
                check('Debated', 'debated', a.quickDebatedBtn),
                { separator: true },
                check('Filter Bar', 'filters', a.filterToggleBtn),
                { text: 'Reset Filters', action: 'reset' }
            ];
        }

        run(action) {
            const a = this.app;
            const map = {
                home: a.homeBtn,
                refresh: a.refreshBtn,
                custom: a.openCustomTagBtn,
                close: a.closeBtn,
                goat: a.quickGoatBtn,
                gems: a.quickGemsBtn,
                debated: a.quickDebatedBtn,
                filters: a.filterToggleBtn,
                reset: a.resetFiltersBtn
            };
            const btn = map[action];
            if (btn && !btn.disabled) btn.click();
        }
    }

    root.NaxtVistaChrome = NaxtVistaChrome;
    if (typeof module !== 'undefined' && module.exports) module.exports = NaxtVistaChrome;
})(typeof window !== 'undefined' ? window : globalThis);
