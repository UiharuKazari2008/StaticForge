/**
 * Atelier on the Vista desktop (Yukimi 2026-10-13): a light Vista window whose caption controls
 * move to a menu bar (Vista's: Explorer's menu bar on the VM, styles in public/css/vista-atelier.css).
 *
 *   File      Home, Refresh, Add Custom Tag…, Close
 *   View      GOAT, Hidden Gems, Debated (the quick filters), Filter Bar, Reset Filters
 *   Dataset   Marks   Pins   Tag Bag    the window's own dropdown buttons, moved into the bar;
 *                                        their click menus (naxtApplet.js setupClickMenus) stay
 *
 * File and View drive the window's buttons, which stay in the caption hidden, so naxtApplet.js
 * keeps every handler and state. The search box stays on the glass, top right, as in Vista's
 * own programs. Off the Vista desktop (classic theme, no desktop) everything goes back.
 */
(function (root) {
    'use strict';

    const MOVED = [
        ['naxtDatasetDropdownBtn', 'Dataset'],
        ['naxtMarkFilterDropdownBtn', 'Marks'],
        ['naxtElevatePinsDropdownBtn', 'Pins'],
        ['naxtBagDropdownBtn', 'Tag Bag']
    ];

    class NaxtVistaChrome {
        constructor(app) {
            this.app = app;
            this.modal = app.modal;
            this.content = this.modal.querySelector('.modal-content');
            this.homes = new Map();
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
        }

        /** Into the menu bar on the Vista desktop, back to the caption elsewhere. */
        place() {
            const on = this.isOn();
            if (this._placed === on) return;
            this._placed = on;
            this.modal.classList.toggle('naxt-vista', on);
            if (on) {
                this.modal.dataset.windowClient = 'light';
                if (this.content) this.content.classList.add('win7');
                this.homes.forEach((_home, btn) => {
                    btn.classList.add('naxt-menu-title');
                    btn.setAttribute('role', 'menuitem');
                    this.bar.appendChild(btn);
                });
                return;
            }
            delete this.modal.dataset.windowClient;
            if (this.content) this.content.classList.remove('win7');
            // last first: each button's old neighbour is often the next moved one
            [...this.homes].reverse().forEach(([btn, home]) => {
                btn.classList.remove('naxt-menu-title');
                btn.removeAttribute('role');
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
