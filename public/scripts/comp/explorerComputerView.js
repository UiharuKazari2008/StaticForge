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
 *   Portable Devices       each phone connected over ActiveSync (guest or partner; activeSyncAgent.js),
 *                          a tile with wpdshext.dll icon 14 and its name, as Vista lists a Windows
 *                          Mobile device; selected: name + "Portable Device" in the details pane.
 *                          Opening it goes to its page, "Computer/dev:<deviceId>" (Computer ▸ Galaxy
 *                          Fold): the phone's storages as drive tiles with their space bars (internal
 *                          = imageres 26, a card / USB = 29, no letters), opening to phone://<root>
 *                          (explorerPhoneDrive.js over activeSyncRemoteStorage.js). Inside the
 *                          Android app the phone is this computer: its roots stay removable disks.
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
    // a portable device's own page under Computer (Vista: Computer ▸ Pocket_PC): "Computer/dev:<deviceId>"
    const DEVICE_PREFIX = 'Computer/dev:';
    const DRIVES = [{ letter: 'C', label: 'Local Disk', path: '/' }];
    // the column headers Vista gives Computer (VM: 80, 80, 80 and 85px, grouped and sorted by Type)
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
            // phones come and go over ActiveSync: Portable Devices follows them while Computer is open
            const as = root.activeSync;
            if (as && typeof as.on === 'function') {
                as.on('state', () => {
                    if (!ExplorerComputerView.isPath(this.app.currentPath)) return;
                    const sig = JSON.stringify(this.portableDevices().map((d) => [d.key, d.name, d.files]));
                    if (sig === this._deviceSig) {
                        // battery, signal and sync news: the details pane of the device on screen
                        if (this.deviceId() || this.portableDevice(this.selected)) this.app.renderStatusText();
                        return;
                    }
                    this._deviceSig = sig;
                    if (this.deviceId()) void this.showDevice();
                    else this.render();
                    this.app.renderStatusText();
                });
            }
        }

        static isPath(path) {
            return path === COMPUTER_PATH || String(path || '').startsWith(DEVICE_PREFIX);
        }

        static devicePath(deviceId) {
            return DEVICE_PREFIX + encodeURIComponent(deviceId);
        }

        /** The device whose page a path is, or null (Computer itself, anything else). */
        static deviceIdOf(path) {
            const s = String(path || '');
            return s.startsWith(DEVICE_PREFIX) ? decodeURIComponent(s.slice(DEVICE_PREFIX.length)) || null : null;
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
                const toggle = ev.target.closest('.explorer-computer-group-toggle');
                if (toggle) {
                    // every group folds on its own chevron, as in Vista; Hard Disk Drives keeps this.collapsed
                    const group = toggle.dataset.group;
                    if (!group) this.collapsed = !this.collapsed;
                    else if (this.collapsedGroups.has(group)) this.collapsedGroups.delete(group);
                    else this.collapsedGroups.add(group);
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
                } else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'Home') && !this.selected && !this.collapsed && !this.deviceId()) {
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
            header.insertAdjacentHTML('beforeend', COLUMNS.map((c) => `<button type="button" class="explorer-details-sort-col explorer-computer-col${c.active ? ' active' : ''}" tabindex="-1"><span class="explorer-details-col-label">${esc(c.label)}</span>${c.active ? '<i class="explorer-details-sort-icon fas fa-sort-up" aria-hidden="true"></i>' : ''}</button>`).join(''));
        }

        onMenuAction(action) {
            const a = String(action || '');
            if (a.startsWith('computer-open:')) this.openDrive(a.slice('computer-open:'.length));
            else if (a === 'computer-refresh') this.show({ reload: true });
        }

        drive(letter) {
            return DRIVES.find((d) => d.letter === letter) || null;
        }

        /** The phone's drives as removable disks (explorerPhoneDrive.js): only inside the Android app,
            where the phone is this computer. A phone reached over ActiveSync is a portable device. */
        phoneDrives() {
            if (root.phoneStorage && root.phoneStorage.remote) return [];
            return root.explorerPhoneDrive && root.explorerPhoneDrive.available() ? root.explorerPhoneDrive.computerDrives() : [];
        }

        /** Portable Devices: every phone connected over ActiveSync (activeSyncAgent.js), guest or partner,
            as Vista lists a connected Windows Mobile device (VM: Pocket_PC, wpdshext.dll icon 14). */
        portableDevices() {
            const as = root.activeSync;
            if (!as || as.kind !== 'computer' || typeof as.state !== 'function') return [];
            const st = as.state() || {};
            return (st.devices || [])
                .filter((d) => d.online && (d.session === 'guest' || d.session === 'partner'))
                .map((d) => ({
                    key: `dev:${d.deviceId}`,
                    deviceId: d.deviceId,
                    name: d.name || 'Phone',
                    files: Array.isArray(d.permissions) && d.permissions.includes('files'),
                    raw: d
                }));
        }

        /** The device's state for the details pane, as Mobile Device Center shows it: status, battery,
            connection, cellular signal, sync (activeSyncAgent.js status reports). */
        deviceFacts(dev) {
            const d = (dev && dev.raw) || {};
            const st = d.status || {};
            const out = [];
            out.push(['Status', esc(d.session === 'partner' ? 'Connected (partnership)' : 'Connected (guest)')]);
            const b = st.battery;
            if (b && b.level != null) {
                const art = b.level < 10 ? 0 : b.level < 35 ? 1 : b.level < 60 ? 2 : b.level < 85 ? 3 : 4;
                out.push(['Battery', `<img class="explorer-details-inline-icon" src="/static_images/activesync/battery-${art}-16.png" alt="">${esc(`${Math.round(b.level)}%${b.charging ? ', charging' : ''}${b.saver ? ', battery saver on' : ''}`)}`]);
            }
            const bars = (n) => (n == null ? '' : `, signal ${n} of 4`);
            const wifi = st.wifi && st.wifi.connected ? `${st.wifi.ssid || 'Connected'}${bars(st.wifi.level)}` : '';
            const cell = st.cellular && st.cellular.present
                ? (st.cellular.airplane ? 'Flight mode' : [st.cellular.operator, st.cellular.dataType, st.cellular.roaming ? 'roaming' : ''].filter(Boolean).join(' ') + bars(st.cellular.level))
                : '';
            // the link Dreamscape reaches the phone over, then the radio it uses for data
            const via = st.active === 'wifi' ? 'Wi-Fi' : st.active === 'cellular' ? 'Cellular data' : st.active === 'ethernet' ? 'Ethernet' : '';
            out.push(['Connected via', esc(['ActiveSync', via].filter(Boolean).join(' over '))]);
            if (wifi) out.push(['Wi-Fi', esc(wifi)]);
            if (cell) out.push(['Signal', esc(cell)]);
            const as = root.activeSync;
            const syncing = as && typeof as.transferring === 'function' && as.transferring();
            const when = (ms) => {
                if (!ms) return 'Never';
                const t = new Date(ms);
                const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                return t.toDateString() === new Date().toDateString() ? `Today at ${time}` : `${t.toLocaleDateString()} at ${time}`;
            };
            out.push(['Sync', esc(syncing ? 'Synchronizing…' : d.partner ? `Last synchronized: ${when(d.lastSync)}` : 'Not set up (guest)')]);
            if (d.queued) out.push(['Waiting', esc(`${d.queued} item${d.queued === 1 ? '' : 's'} for the device`)]);
            return out;
        }

        portableDevice(key) {
            return String(key || '').startsWith('dev:') ? (this.portableDevices().find((d) => d.key === key) || null) : null;
        }

        /** The device whose page is on screen (Computer ▸ <device>), or null. */
        deviceId() {
            return ExplorerComputerView.deviceIdOf(this.app.currentPath);
        }

        deviceName(deviceId) {
            const d = this.portableDevices().find((x) => x.deviceId === deviceId);
            if (d) return d.name;
            const as = root.activeSync;
            const known = as && typeof as.state === 'function' ? (as.state().devices || []).find((x) => x.deviceId === deviceId) : null;
            return (known && known.name) || 'Portable Device';
        }

        /** The title / crumb for a Computer path: Computer, or the device's name. */
        placeName(path) {
            const id = ExplorerComputerView.deviceIdOf(path);
            return id ? this.deviceName(id) : 'Computer';
        }

        /** The device page's storages: the phone's roots once its storage answers, or why not. */
        deviceStorage() {
            const id = this.deviceId();
            if (!id) return { roots: [], block: null };
            const dev = this.portableDevices().find((d) => d.deviceId === id);
            if (!dev) return { roots: [], block: 'This device is not connected.' };
            if (!dev.files) return { roots: [], block: 'This computer has no access to the files on the device. Allow it in ActiveSync on the device.' };
            const ps = root.phoneStorage;
            const st = ps && ps.remote && ps.deviceId === id ? ps.state() : null;
            if (!st) return { roots: [], block: 'Connecting to the device…' };
            if (!st.enabled) return { roots: [], block: 'Turn on phone storage in the app on the device.' };
            if (!st.access) return { roots: [], block: 'Allow storage access on the device.' };
            if (st.locked) return { roots: [], block: 'Unlock the app on the device to browse its files.' };
            const roots = (Array.isArray(st.roots) ? st.roots : []).map((r) => ({
                key: `st:${r.id}`,
                rootId: r.id,
                name: r.name || r.id,
                // VM: the device's own memory is a fixed disk (imageres 26), a card a removable one (29)
                icon: r.kind === 'internal' ? 'drive-fixed' : 'drive-removable',
                total: Number(r.total) || 0,
                free: Number(r.free) || 0
            }));
            return { roots, block: roots.length ? null : 'This device has no storage to show.' };
        }

        storage(key) {
            return String(key || '').startsWith('st:') ? (this.deviceStorage().roots.find((r) => r.key === key) || null) : null;
        }

        /** Opens a device page: that phone becomes the one phoneStorage shows, then its storages list. */
        async showDevice() {
            const path = this.app.currentPath;
            const id = ExplorerComputerView.deviceIdOf(path);
            const ps = root.phoneStorage;
            if (id && ps && ps.remote) {
                if (ps.deviceId !== id) ps.select(id);
                // storage events re-render this page (explorerPhoneDrive.js bind: config / state)
                if (root.explorerPhoneDrive) root.explorerPhoneDrive.attach(this.app);
            }
            this.render();
            if (id && ps && ps.remote && ps.deviceId === id && typeof ps.hello === 'function') {
                try { await ps.hello(); } catch (_err) { /* the block line says why */ }
            }
            if (this.app.currentPath !== path) return;
            this.render();
            this.app.renderStatusText();
        }

        phoneDrive(key) {
            return String(key || '').startsWith('phone:') ? (this.phoneDrives().find((d) => d.key === key) || null) : null;
        }

        /** Network drives (Network Location): Sequenzia, when this server has it set up (explorerSequenzia.js). */
        networkDrives() {
            return root.explorerSequenzia ? root.explorerSequenzia.computerDrives() : [];
        }

        networkDrive(key) {
            return String(key || '').startsWith('net:') ? (this.networkDrives().find((d) => d.key === key) || null) : null;
        }

        /** A phone root's icon: Vista's removable disk (imageres.dll 29), never the system drive's. */
        deviceIcon(d, size) {
            return `<img class="explorer-computer-tile-icon" src="${ART}/${d.icon || 'drive-removable'}-${size}.png" alt="" draggable="false">`;
        }

        driveName(d) {
            return `${d.label} (${d.letter}:)`;
        }

        openDrive(letter) {
            const dev = this.portableDevice(letter);
            if (dev) {
                this.app.navigateTo(ExplorerComputerView.devicePath(dev.deviceId));
                return;
            }
            const store = this.storage(letter);
            if (store) {
                this.app.navigateTo(`phone://${encodeURIComponent(store.rootId)}`);
                return;
            }
            if (this.phoneDrive(letter)) {
                root.explorerPhoneDrive.openComputerDrive(this.app, letter);
                return;
            }
            const net = this.networkDrive(letter);
            if (net) {
                if (net.online) this.app.navigateTo(net.path);
                else this.networkUnavailable(net);
                return;
            }
            const d = this.drive(letter);
            if (d) this.app.navigateTo(d.path);
        }

        /** Vista's words for a mapped drive it cannot reach. */
        networkUnavailable(net) {
            if (typeof root.showConfirmationDialog !== 'function') return;
            const why = net.error ? `<br><br>${esc(net.error)}` : '';
            root.showConfirmationDialog(`<p>An error occurred while reconnecting Z: to \\\\Kanmi\\Sequenzia<br>The network path was not found.${why}</p>`,
                [{ text: 'OK', value: true, className: 'btn-standard primary' }], null,
                { title: 'Restoring Network Connections', showCloseButton: true });
        }

        select(letter) {
            this.selected = letter && (this.drive(letter) || this.phoneDrive(letter) || this.networkDrive(letter) || this.portableDevice(letter) || this.storage(letter)) ? letter : null;
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
            // the phones as the server has them now, in case a peers update was missed ('state' re-renders)
            const as = root.activeSync;
            if (as && as.kind === 'computer' && typeof as.refresh === 'function' && Date.now() - (this._devicesAt || 0) > 5000) {
                this._devicesAt = Date.now();
                as.refresh().catch(() => {});
            }
            if (this.deviceId()) {
                await this.showDevice();
                return;
            }
            this.render();
            // the network drive's state arrives on its own; the tile appears (or changes) when it does
            const net = root.explorerSequenzia ? root.explorerSequenzia.refreshStatus(reload) : null;
            await this.load(reload);
            if (!ExplorerComputerView.isPath(this.app.currentPath)) return;
            this.render();
            this.app.renderStatusText();
            if (net) {
                const before = JSON.stringify(this.networkDrives());
                net.then(() => {
                    if (!ExplorerComputerView.isPath(this.app.currentPath) || JSON.stringify(this.networkDrives()) === before) return;
                    this.render();
                    this.app.renderStatusText();
                });
            }
        }

        render() {
            if (!this.el) return;
            if (this.deviceId()) {
                this.renderDevice();
                return;
            }
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
            const phones = this.phoneDrives();
            const phoneTiles = phones.map((d) => {
                const used = d.total ? Math.max(0, Math.min(1, 1 - d.free / d.total)) : 0;
                const full = d.total && d.free / d.total < 0.1;
                const bar = d.total
                    ? `<div class="explorer-drive-bar${full ? ' is-full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(used * 100)}"><div class="explorer-drive-bar-fill" style="--used:${used.toFixed(4)}"></div></div>`
                    : '';
                const line = d.block ? d.block.text : (d.total ? `${formatSize(d.free)} free of ${formatSize(d.total)}` : '');
                return `<div class="explorer-computer-tile${d.key === this.selected ? ' is-selected' : ''}${d.block ? ' is-blocked' : ''}" data-drive="${esc(d.key)}" role="option" aria-selected="${d.key === this.selected}" title="${esc(line)}">
                        ${this.deviceIcon(d, 48)}
                        <div class="explorer-computer-tile-text">
                            <div class="explorer-computer-tile-name">${esc(d.name)}</div>
                            ${bar}
                            <div class="explorer-computer-tile-free">${esc(line)}</div>
                        </div>
                    </div>`;
            }).join('');
            // removable disks are Vista's own group below the hard disks
            const phoneGroup = phones.length ? `
                <section class="explorer-computer-group explorer-computer-group-devices${this.groupFolded('devices') ? ' is-collapsed' : ''}">
                    <h3 class="explorer-computer-group-head"><span>Devices with Removable Storage (${phones.length})</span>${this.groupToggle('devices')}</h3>
                    <div class="explorer-computer-tiles">${phoneTiles}</div>
                </section>` : '';
            this.el.innerHTML = `
                <section class="explorer-computer-group${this.collapsed ? ' is-collapsed' : ''}">
                    <h3 class="explorer-computer-group-head"><span>Hard Disk Drives (${DRIVES.length})</span><button type="button" class="explorer-computer-group-toggle" tabindex="-1" aria-expanded="${!this.collapsed}" aria-label="${this.collapsed ? 'Expand' : 'Collapse'} the group"></button></h3>
                    <div class="explorer-computer-tiles">${tiles}</div>
                </section>${phoneGroup}${this.portableGroup()}${this.networkGroup()}`;
        }

        /** Vista's Portable Devices group: a tile a device, its icon and name (no space bar). */
        portableGroup() {
            const devices = this.portableDevices();
            this._deviceSig = JSON.stringify(devices.map((d) => [d.key, d.name, d.files]));
            if (!devices.length) return '';
            const tiles = devices.map((d) => `<div class="explorer-computer-tile explorer-computer-tile-device${d.key === this.selected ? ' is-selected' : ''}" data-drive="${esc(d.key)}" role="option" aria-selected="${d.key === this.selected}" title="${esc(d.name)}">
                        <img class="explorer-computer-tile-icon" src="${ART}/portable-device-48.png" alt="" draggable="false">
                        <div class="explorer-computer-tile-text">
                            <div class="explorer-computer-tile-name">${esc(d.name)}</div>
                        </div>
                    </div>`).join('');
            return `
                <section class="explorer-computer-group explorer-computer-group-portable${this.groupFolded('portable') ? ' is-collapsed' : ''}">
                    <h3 class="explorer-computer-group-head"><span>Portable Devices (${devices.length})</span>${this.groupToggle('portable')}</h3>
                    <div class="explorer-computer-tiles">${tiles}</div>
                </section>`;
        }

        /** A device's page (VM: Computer ▸ Pocket_PC): its storages as drive tiles, no group heading. */
        renderDevice() {
            const { roots, block } = this.deviceStorage();
            if (block) {
                this.el.innerHTML = `<div class="explorer-computer-empty">${esc(block)}</div>`;
                return;
            }
            const tiles = roots.map((r) => {
                const used = r.total ? Math.max(0, Math.min(1, 1 - r.free / r.total)) : 0;
                const full = r.total && r.free / r.total < 0.1;
                const bar = r.total
                    ? `<div class="explorer-drive-bar${full ? ' is-full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(used * 100)}"><div class="explorer-drive-bar-fill" style="--used:${used.toFixed(4)}"></div></div>`
                    : '';
                const line = r.total ? `${formatSize(r.free)} free of ${formatSize(r.total)}` : '';
                return `<div class="explorer-computer-tile${r.key === this.selected ? ' is-selected' : ''}" data-drive="${esc(r.key)}" role="option" aria-selected="${r.key === this.selected}" title="${esc(line)}">
                        <img class="explorer-computer-tile-icon" src="${ART}/${r.icon}-48.png" alt="" draggable="false">
                        <div class="explorer-computer-tile-text">
                            <div class="explorer-computer-tile-name">${esc(r.name)}</div>
                            ${bar}
                            <div class="explorer-computer-tile-free">${esc(line)}</div>
                        </div>
                    </div>`;
            }).join('');
            this.el.innerHTML = `
                <section class="explorer-computer-group explorer-computer-group-storage">
                    <div class="explorer-computer-tiles">${tiles}</div>
                </section>`;
        }

        groupFolded(group) {
            if (!this.collapsedGroups) this.collapsedGroups = new Set();
            return this.collapsedGroups.has(group);
        }

        groupToggle(group) {
            const folded = this.groupFolded(group);
            return `<button type="button" class="explorer-computer-group-toggle" data-group="${group}" tabindex="-1" aria-expanded="${!folded}" aria-label="${folded ? 'Expand' : 'Collapse'} the group"></button>`;
        }

        /** Vista's Network Location group: mapped drives, below the disks and devices. */
        networkGroup() {
            const nets = this.networkDrives();
            if (!nets.length) return '';
            const tiles = nets.map((d) => `<div class="explorer-computer-tile${d.key === this.selected ? ' is-selected' : ''}" data-drive="${esc(d.key)}" role="option" aria-selected="${d.key === this.selected}" title="${esc(d.line || d.name)}">
                        ${this.deviceIcon(d, 48)}
                        <div class="explorer-computer-tile-text">
                            <div class="explorer-computer-tile-name">${esc(d.name)}</div>
                            <div class="explorer-computer-tile-free">${esc(d.line)}</div>
                        </div>
                    </div>`).join('');
            return `
                <section class="explorer-computer-group explorer-computer-group-network${this.groupFolded('network') ? ' is-collapsed' : ''}">
                    <h3 class="explorer-computer-group-head"><span>Network Location (${nets.length})</span>${this.groupToggle('network')}</h3>
                    <div class="explorer-computer-tiles">${tiles}</div>
                </section>`;
        }

        /** Vista's status words for the old status line (classic theme). */
        statusText() {
            if (this.deviceId()) {
                const store = this.storage(this.selected);
                if (store) return store.total ? `${formatSize(store.free)} free of ${formatSize(store.total)}` : '1 item selected';
                const n = this.deviceStorage().roots.length;
                return `${n} item${n === 1 ? '' : 's'}`;
            }
            if (this.portableDevice(this.selected)) return '1 item selected';
            const phone = this.phoneDrive(this.selected);
            if (phone) return phone.block ? phone.block.text : (phone.total ? `${formatSize(phone.free)} free of ${formatSize(phone.total)}` : '1 item selected');
            const net = this.networkDrive(this.selected);
            if (net) return net.online ? '1 item selected' : net.line;
            const count = DRIVES.length + this.phoneDrives().length + this.portableDevices().length + this.networkDrives().length;
            if (this.selected) {
                const disk = diskFacts(this.sys);
                return disk ? `${formatSize(disk.free)} free of ${formatSize(disk.total)}` : '1 item selected';
            }
            return `${count} item${count === 1 ? '' : 's'}`;
        }

        /** A device in the details pane: its name, then the facts two pairs a line (Status | Battery,
            Connected via | Wi-Fi, Signal | Sync ...) in Vista's details grid. */
        deviceGrid(grid, dev) {
            const facts = this.deviceFacts(dev);
            const lines = [];
            for (let i = 0; i < facts.length; i += 2) lines.push([facts[i], facts[i + 1] || null]);
            return `<div class="explorer-details-grid">`
                + `<div class="explorer-details-name">${esc(dev.name)}</div>`
                + lines.map((pairs, i) => `${i ? '<span></span>' : ''}${pairs.map((p) => (p
                    ? `<span class="explorer-details-label">${esc(p[0])}:</span><span class="explorer-details-value">${p[1]}</span>`
                    : '<span></span><span></span>')).join('')}`).join('')
                + '</div>';
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
            const setIcon = (key, file) => {
                if (icon.dataset.detailsKey === key) return;
                icon.dataset.detailsKey = key;
                icon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                icon.innerHTML = `<img class="explorer-details-shell-icon" src="${ART}/${file}" alt="" draggable="false">`;
            };
            if (this.deviceId()) {
                // a storage: its space; nothing selected: the device and its item count (VM)
                const store = this.storage(this.selected);
                if (store) {
                    setIcon(`computer:${store.key}`, `${store.icon}-64.png`);
                    const used = store.total ? Math.max(0, Math.min(1, 1 - store.free / store.total)) : 0;
                    info.innerHTML = grid(store.name, [
                        ['Space used', store.total ? `<span class="explorer-drive-bar"><span class="explorer-drive-bar-fill" style="--used:${used.toFixed(4)}"></span></span>` : ''],
                        ['Space free', store.total ? esc(formatSize(store.free)) : ''],
                        ['Total size', store.total ? esc(formatSize(store.total)) : '']
                    ]);
                    return;
                }
                setIcon('computer:device', 'portable-device-64.png');
                const here = this.portableDevices().find((x) => x.deviceId === this.deviceId());
                info.innerHTML = here ? this.deviceGrid(grid, here) : `<div class="explorer-details-summary">${esc(this.statusText())}</div>`;
                return;
            }
            const device = this.portableDevice(this.selected);
            if (device) {
                setIcon(`computer:${device.key}`, 'portable-device-64.png');
                info.innerHTML = this.deviceGrid(grid, device);
                return;
            }
            const phone = this.phoneDrive(this.selected);
            if (phone) {
                const pkey = `computer:${phone.key}`;
                if (icon.dataset.detailsKey !== pkey) {
                    icon.dataset.detailsKey = pkey;
                    icon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                    icon.innerHTML = this.deviceIcon(phone, 64).replace('explorer-computer-tile-icon', 'explorer-details-shell-icon');
                }
                const used = phone.total ? Math.max(0, Math.min(1, 1 - phone.free / phone.total)) : 0;
                info.innerHTML = phone.block
                    ? grid(phone.name, [['Status', esc(phone.block.text)]])
                    : grid(phone.name, [
                        ['Space used', phone.total ? `<span class="explorer-drive-bar"><span class="explorer-drive-bar-fill" style="--used:${used.toFixed(4)}"></span></span>` : ''],
                        ['Space free', phone.total ? esc(formatSize(phone.free)) : ''],
                        ['Total size', phone.total ? esc(formatSize(phone.total)) : '']
                    ]);
                return;
            }
            const net = this.networkDrive(this.selected);
            if (net) {
                const nkey = `computer:${net.key}:${net.icon}`;
                if (icon.dataset.detailsKey !== nkey) {
                    icon.dataset.detailsKey = nkey;
                    icon.className = 'explorer-details-icon explorer-item-icon-box explorer-item-icon-box-md';
                    icon.innerHTML = this.deviceIcon(net, 64).replace('explorer-computer-tile-icon', 'explorer-details-shell-icon');
                }
                info.innerHTML = grid(net.name, [
                    ['Network location', esc('\\\\Kanmi\\Sequenzia')],
                    ['Status', esc(net.online ? 'Connected' : 'Disconnected')]
                ], net.user ? ['User', esc(net.user)] : null);
                return;
            }
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
    ExplorerComputerView.DEVICE_PREFIX = DEVICE_PREFIX;
    /** The Cartograph root as Vista names the system drive (the breadcrumb, Recent Pages). */
    ExplorerComputerView.ROOT_NAME = `${DRIVES[0].label} (${DRIVES[0].letter}:)`;
    ExplorerComputerView._test = { parseSize, formatSize, diskFacts, hostFacts };
    root.ExplorerComputerView = ExplorerComputerView;
    root.EXPLORER_COMPUTER_PATH = COMPUTER_PATH;
})(typeof window !== 'undefined' ? window : globalThis);
