/**
 * Cartograph's Computer: Vista's Computer folder, the place above the drives (1:1 with the VM's
 * Computer window in Tiles view, 2026-10-22).
 *
 *   column headers         Name, Type (sorted), Total Size, Free Space, as Vista heads Computer
 *   Hard Disk Drives (1)   with the group's collapse chevron; one drive, Local Disk (C:): the
 *                          Cartograph root ("/") on the server's system disk. Its tile is the 48px
 *                          system-drive icon (imageres.dll 30), the name, a 156x13 bar of the used
 *                          space (aero.msstyles PROGRESS with the
 *                          partial teal fill, IMAGE 629; Vista turns it red under 10% free) and
 *                          "38.1 GB free of 63.9 GB" in grey. The sizes come from get_system_info
 *                          disk (modules/globalResources.js refreshSystemInfoCache: statfs of the
 *                          project's filesystem).
 *   details pane           nothing selected: the computer (imageres.dll 103), its name, processor
 *                          and memory; the drive selected: Space used / Space free / Total size,
 *                          File system (the disk's statfs type, when the server sends it)
 *   command bar            System properties (Control Panel > System) and Open Control Panel, as
 *                          Vista's Computer has them (explorerVistaChrome.js syncCommands)
 *
 * The applet (explorerApplet.js) routes the path EXPLORER_COMPUTER_PATH here instead of the VFS:
 * show() on refresh, renderDetails() from renderStatusText. Styles: vista-explorer.css "Computer".
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-explorer';
    const COMPUTER_PATH = 'Computer';
    const DRIVES = [{ letter: 'C', label: 'Local Disk', path: '/' }];
    // the column headers Vista gives Computer (VM: 78, 80, 80 and 85px, grouped and sorted by Type)
    const COLUMNS = [{ label: 'Name' }, { label: 'Type', active: true }, { label: 'Total Size' }, { label: 'Free Space' }];

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** "63.90 GB" (globalResources formatBytes) back to bytes, for servers without the byte fields. */
    function parseSize(text) {
        const m = String(text || '').trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
        if (!m) return 0;
        const pow = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 }[m[2].toUpperCase()];
        return Math.round(parseFloat(m[1]) * (1024 ** pow));
    }

    /** StrFormatByteSize as Vista prints drive sizes: three digits, truncated ("38.1 GB", "932 GB"). */
    function formatSize(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n < 0) return '';
        const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let value = n;
        let unit = 0;
        while (value >= 1000 && unit < units.length - 1) {
            value /= 1024;
            unit += 1;
        }
        if (unit === 0) return `${Math.floor(value)} bytes`;
        const decimals = value < 10 ? 2 : value < 100 ? 1 : 0;
        const scale = 10 ** decimals;
        return `${(Math.floor(value * scale) / scale).toFixed(decimals)} ${units[unit]}`;
    }

    /** The disk from get_system_info: bytes when the server sends them, else parsed from its text. */
    function diskFacts(sys) {
        const disk = (sys && sys.disk) || {};
        const total = Number(disk.totalBytes) || parseSize(disk.total);
        const free = Number.isFinite(Number(disk.freeBytes)) && disk.freeBytes != null
            ? Number(disk.freeBytes) : parseSize(disk.free);
        if (!total) return null;
        const usedFraction = Math.min(1, Math.max(0, (total - free) / total));
        return { total, free, usedFraction, full: free / total < 0.1, fileSystem: disk.fileSystem || '' };
    }

    /** The computer's name, processor and memory, as cplSystem.js reads them from get_system_info. */
    function hostFacts(sys) {
        const host = (sys && sys.host) || {};
        const cpuText = sys && typeof sys.cpu === 'string' ? sys.cpu.replace(/\s*\(\d+ cores\)\s*$/, '') : '';
        return {
            name: String(host.hostname || '').toUpperCase(),
            processor: host.cpuModel || (cpuText && cpuText !== 'Unknown' ? cpuText : ''),
            memory: host.totalMemBytes ? formatSize(host.totalMemBytes) : (sys && sys.ram) || ''
        };
    }

    function ws() {
        if (typeof root.wsClient !== 'undefined' && root.wsClient) return root.wsClient;
        return typeof wsClient !== 'undefined' ? wsClient : null;
    }

    class ExplorerComputerView {
        constructor(app) {
            this.app = app;
            this.sys = null;
            this.selected = null;
            this.el = null;
            this._loading = null;
            this.mount();
        }

        static isPath(path) {
            return path === COMPUTER_PATH;
        }

        /** Typed into the address box: "Computer" in any case. */
        static matchesInput(text) {
            return String(text || '').trim().toLowerCase() === COMPUTER_PATH.toLowerCase();
        }

        mount() {
            const host = document.getElementById('explorerGridHost');
            if (!host || !host.parentNode) return;
            const el = document.createElement('div');
            el.id = 'explorerComputerView';
            el.className = 'explorer-computer-view';
            el.tabIndex = 0;
            el.setAttribute('role', 'listbox');
            el.setAttribute('aria-label', 'Computer');
            host.parentNode.insertBefore(el, host.nextSibling);
            this.el = el;
            this.mountColumns();

            el.addEventListener('click', (ev) => {
                if (ev.target.closest('.explorer-computer-group-toggle')) {
                    this.collapsed = !this.collapsed;
                    this.render();
                    return;
                }
                const tile = ev.target.closest('[data-drive]');
                this.select(tile ? tile.dataset.drive : null);
            });
            el.addEventListener('dblclick', (ev) => {
                const tile = ev.target.closest('[data-drive]');
                if (tile) this.openDrive(tile.dataset.drive);
            });
            el.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && this.selected) {
                    ev.preventDefault();
                    this.openDrive(this.selected);
                } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'Home') && !this.selected && !this.collapsed) {
                    ev.preventDefault();
                    this.select(DRIVES[0].letter);
                }
            });
            if (typeof root.contextMenu !== 'undefined' && root.contextMenu) {
                const config = {
                    sections: [],
                    beforeShow: (event) => {
                        const tile = event.target.closest('[data-drive]');
                        if (tile) this.select(tile.dataset.drive);
                        config.sections = [{
                            type: 'list',
                            items: tile
                                ? [{ text: 'Open', action: `computer-open:${tile.dataset.drive}` }]
                                : [{ text: 'Refresh', action: 'computer-refresh' }]
                        }];
                    },
                    onAction: (action) => this.onMenuAction(action)
                };
                root.contextMenu.attachToElement(el, config);
            }
        }

        /** Computer's columns beside the folder ones in #explorerDetailsHeader; explorer.css shows one
            set or the other (.explorer-in-computer). They carry no data-sort-field, so the applet's
            sort wiring passes them by. */
        mountColumns() {
            const header = document.getElementById('explorerDetailsHeader');
            if (!header || header.querySelector('.explorer-computer-col')) return;
            header.insertAdjacentHTML('beforeend', COLUMNS.map((c) => `<button type="button" class="explorer-details-sort-col explorer-computer-col${c.active ? ' active' : ''}" tabindex="-1"><span class="explorer-details-col-label">${esc(c.label)}</span></button>`).join(''));
        }

        onMenuAction(action) {
            const a = String(action || '');
            if (a.startsWith('computer-open:')) this.openDrive(a.slice('computer-open:'.length));
            else if (a === 'computer-refresh') this.show({ reload: true });
        }

        drive(letter) {
            return DRIVES.find((d) => d.letter === letter) || null;
        }

        driveName(d) {
            return `${d.label} (${d.letter}:)`;
        }

        openDrive(letter) {
            const d = this.drive(letter);
            if (d) this.app.navigateTo(d.path);
        }

        select(letter) {
            this.selected = letter && this.drive(letter) ? letter : null;
            if (this.el) {
                this.el.querySelectorAll('[data-drive]').forEach((t) => {
                    const on = t.dataset.drive === this.selected;
                    t.classList.toggle('is-selected', on);
                    t.setAttribute('aria-selected', on ? 'true' : 'false');
                });
            }
            this.app.renderStatusText();
        }

        async load(force) {
            if (this.sys && !force) return this.sys;
            if (this._loading) return this._loading;
            const client = ws();
            if (!client || (client.isConnected && !client.isConnected())) return this.sys;
            this._loading = client.sendMessage('get_system_info', {})
                .then((sys) => { this.sys = sys || this.sys; return this.sys; })
                .catch(() => this.sys)
                .finally(() => { this._loading = null; });
            return this._loading;
        }

        /** The view on screen; the sizes fill in when get_system_info answers. */
        async show({ reload = false } = {}) {
            if (!this.el) return;
            this.selected = null;
            this.render();
            await this.load(reload);
            if (!ExplorerComputerView.isPath(this.app.currentPath)) return;
            this.render();
            this.app.renderStatusText();
        }

        render() {
            if (!this.el) return;
            const disk = diskFacts(this.sys);
            const tiles = DRIVES.map((d) => {
                const bar = disk
                    ? `<div class="explorer-drive-bar${disk.full ? ' is-full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(disk.usedFraction * 100)}"><div class="explorer-drive-bar-fill" style="--used:${disk.usedFraction.toFixed(4)}"></div></div>`
                    : '';
                const free = disk ? `${formatSize(disk.free)} free of ${formatSize(disk.total)}` : '';
                return `<div class="explorer-computer-tile${d.letter === this.selected ? ' is-selected' : ''}" data-drive="${esc(d.letter)}" role="option" aria-selected="${d.letter === this.selected}" title="${esc(free)}">
                        <img class="explorer-computer-tile-icon" src="${ART}/drive-system-48.png" alt="" draggable="false">
                        <div class="explorer-computer-tile-text">
                            <div class="explorer-computer-tile-name">${esc(this.driveName(d))}</div>
                            ${bar}
                            <div class="explorer-computer-tile-free">${esc(free)}</div>
                        </div>
                    </div>`;
            }).join('');
            this.el.innerHTML = `
                <section class="explorer-computer-group${this.collapsed ? ' is-collapsed' : ''}">
                    <h3 class="explorer-computer-group-head"><span>Hard Disk Drives (${DRIVES.length})</span><button type="button" class="explorer-computer-group-toggle" tabindex="-1" aria-expanded="${!this.collapsed}" aria-label="${this.collapsed ? 'Expand' : 'Collapse'} the group"></button></h3>
                    <div class="explorer-computer-tiles">${tiles}</div>
                </section>`;
        }

        /** Vista's status words for the old status line (classic theme). */
        statusText() {
            if (this.selected) {
                const disk = diskFacts(this.sys);
                return disk ? `${formatSize(disk.free)} free of ${formatSize(disk.total)}` : '1 item selected';
            }
            return `${DRIVES.length} item${DRIVES.length === 1 ? '' : 's'}`;
        }

        /** The details pane (explorerVistaChrome.js renderDetails layout and classes). */
        renderDetails() {
            const icon = document.getElementById('explorerDetailsIcon');
            const info = document.getElementById('explorerDetailsInfo');
            if (!icon || !info) return;
            // Vista's grid: the name, then label: value pairs (labels right-aligned), a second pair
            // column on the first line only
            const pair = (label, valueHtml) => (valueHtml
                ? `<span class="explorer-details-label">${esc(label)}:</span><span class="explorer-details-value">${valueHtml}</span>`
                : '<span></span><span></span>');
            // five cells a line: name, label, value, label, value
            const empty = '<span></span><span></span>';
            const grid = (name, rows, extra) => `<div class="explorer-details-grid">`
                + `<div class="explorer-details-name">${esc(name)}</div>${pair(...(rows[0] || ['', '']))}${extra ? pair(...extra) : empty}`
                + rows.slice(1).map((r) => `<span></span>${pair(...r)}${empty}`).join('')
                + '</div>';
            const d = this.selected ? this.drive(this.selected) : null;
            const key = d ? `computer:${d.letter}` : 'computer';
            if (icon.dataset.detailsKey !== key) {
                icon.dataset.detailsKey = key;
                icon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                icon.innerHTML = `<img class="explorer-details-shell-icon" src="${ART}/${d ? 'drive-system-64.png' : 'computer-64.png'}" alt="" draggable="false">`;
            }
            if (d) {
                const disk = diskFacts(this.sys);
                const bar = disk
                    ? `<span class="explorer-drive-bar${disk.full ? ' is-full' : ''}"><span class="explorer-drive-bar-fill" style="--used:${disk.usedFraction.toFixed(4)}"></span></span>`
                    : '';
                info.innerHTML = grid(this.driveName(d), [
                    ['Space used', bar],
                    ['Space free', disk ? esc(formatSize(disk.free)) : ''],
                    ['Total size', disk ? esc(formatSize(disk.total)) : '']
                ], disk && disk.fileSystem ? ['File system', esc(disk.fileSystem)] : null);
                return;
            }
            const host = hostFacts(this.sys);
            info.innerHTML = grid(host.name || 'Computer', [
                ['Processor', esc(host.processor)],
                ['Memory', esc(host.memory)]
            ]);
        }
    }

    ExplorerComputerView.PATH = COMPUTER_PATH;
    /** The Cartograph root as Vista names the system drive (the breadcrumb, Recent Pages). */
    ExplorerComputerView.ROOT_NAME = `${DRIVES[0].label} (${DRIVES[0].letter}:)`;
    ExplorerComputerView._test = { parseSize, formatSize, diskFacts, hostFacts };
    root.ExplorerComputerView = ExplorerComputerView;
    root.EXPLORER_COMPUTER_PATH = COMPUTER_PATH;
})(typeof window !== 'undefined' ? window : globalThis);
