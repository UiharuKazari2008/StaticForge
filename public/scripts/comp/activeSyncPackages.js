/**
 * Package Management (Yozora #823): a connected phone's installed Android programs on the desktop,
 * managed remotely. Device Center > Programs and Services > "Manage programs on your device".
 *
 * The phone answers over ActiveSync (DSApp ActiveSyncPackages.kt):
 *   apps.packages { system }   the programs (label, package, version, size, system, enabled, protected)
 *   apps.icon { package, size } a PNG data URL
 *   apps.manage { package, action }  uninstall | disable | enable | stop | clear | open, over the phone's
 *                              Localhost ADB (Android Bridge > Advanced Tools: Install Android Applications)
 *
 * A Vista window: the shared title toolbar (Open, Stop, Clear Data, Disable / Enable, Uninstall,
 * Refresh), a details list (Name, Version, Size, Type, Status) sorted by column, Show system
 * programs, and a status bar line.
 */
(function (root) {
    'use strict';

    const as = root.activeSync;
    if (!as || as.kind !== 'computer') return;
    const ICONS = '/melaton-apps/activesync/assets';
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const bytes = (n) => { const v = Math.max(0, Number(n) || 0); return v < 1024 ? `${v} bytes` : v < 1048576 ? `${Math.round(v / 1024)} KB` : v < 1073741824 ? `${(v / 1048576).toFixed(1)} MB` : `${(v / 1073741824).toFixed(2)} GB`; };
    const open = new Map(); // deviceId -> window

    function styles() {
        if (document.getElementById('asPkgStyles')) return;
        const st = document.createElement('style');
        st.id = 'asPkgStyles';
        // Vista's ListView in details view (comctl32 v6, Aero): header gradient, hot and selected rows
        st.textContent = `
.as-pkg-window .modal-content { padding: 0; display: flex; flex-direction: column; background: #fff; color: #000; font: 12px 'Segoe UI', Tahoma, sans-serif; overflow: hidden; }
.as-pkg-bar { display: flex; align-items: center; gap: 12px; padding: 5px 8px; border-bottom: 1px solid #d5dfe5; background: #f5f6f7; }
.as-pkg-bar label { display: inline-flex; align-items: center; gap: 4px; }
.as-pkg-list { flex: 1; overflow: auto; }
.as-pkg-list table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; }
.as-pkg-list th { position: sticky; top: 0; z-index: 1; height: 24px; padding: 0 6px; text-align: left; font-weight: normal; color: #4c607a; background: linear-gradient(#fff, #fff 45%, #f3f4f6 46%, #eef0f3); border-bottom: 1px solid #d5d5d5; border-right: 1px solid #e3e6ea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
.as-pkg-list th:hover { background: linear-gradient(#f3faff, #e3f2fd 45%, #d8edfc 46%, #d3ebfc); border-right-color: #bfe0f8; }
.as-pkg-list th.is-sorted::after { content: ''; display: inline-block; margin-left: 6px; border: 4px solid transparent; vertical-align: middle; }
.as-pkg-list th.is-sorted.is-asc::after { border-bottom-color: #8a98a8; margin-top: -4px; }
.as-pkg-list th.is-sorted.is-desc::after { border-top-color: #8a98a8; margin-top: 4px; }
.as-pkg-list td { height: 20px; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid transparent; border-left: 0; border-right: 0; }
.as-pkg-list td:first-child { border-left: 1px solid transparent; border-radius: 3px 0 0 3px; }
.as-pkg-list td:last-child { border-right: 1px solid transparent; border-radius: 0 3px 3px 0; }
.as-pkg-list tr:hover td { background: linear-gradient(#fafdff, #eef7ff); border-color: #b8d6fb; }
.as-pkg-list tr.is-selected td { background: linear-gradient(#eaf6fd, #d9f0fc); border-color: #7da2ce; }
.as-pkg-list tr.is-disabled td { color: #8a8a8a; }
.as-pkg-list td img { width: 16px; height: 16px; vertical-align: -3px; margin-right: 6px; }
.as-pkg-status { padding: 3px 8px; border-top: 1px solid #d5dfe5; background: #f0f0f0; color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.as-pkg-note { padding: 24px; text-align: center; color: #5a5a5a; }`;
        document.head.appendChild(st);
    }

    function view(deviceId) {
        const had = open.get(deviceId);
        if (had) { call('openModal', had.modal); return had; }
        styles();
        const dev = as.device(deviceId);
        const name = (dev && dev.name) || 'Device';
        const m = document.createElement('div');
        m.className = 'modal toolbar-visible hidden as-pkg-window';
        m.id = `activeSyncPackages-${deviceId.slice(0, 8)}`;
        m.dataset.windowIdentifier = 'activeSyncPackages';
        m.dataset.taskbarIcon = `${ICONS}/activesync-32.png`;
        m.dataset.windowDefaultWidth = '720';
        m.dataset.windowDefaultHeight = '520';
        m.style.width = '720px';
        m.style.height = '520px';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-label', `${name} - Programs`);
        m.innerHTML = `
            <div class="modal-window-title">
                <div class="modal-window-title-main"><i class="fas fa-mobile-screen icon-fa"></i><img class="icon-image" src="${ICONS}/activesync-16.png" alt=""><span>${esc(name)} - Programs</span></div>
                <div class="modal-window-title-toolbar">
                    <button type="button" class="btn-secondary" data-pkg="open" disabled>Open</button>
                    <button type="button" class="btn-secondary" data-pkg="stop" disabled>Stop</button>
                    <button type="button" class="btn-secondary" data-pkg="clear" disabled>Clear Data</button>
                    <button type="button" class="btn-secondary" data-pkg="toggle" disabled>Disable</button>
                    <button type="button" class="btn-secondary" data-pkg="uninstall" disabled>Uninstall</button>
                    <button type="button" class="btn-secondary" data-pkg="refresh">Refresh</button>
                </div>
            </div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-secondary maximize-btn btn-small" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content">
                <div class="as-pkg-bar"><label><input type="checkbox" data-pkg-system> Show system programs</label></div>
                <div class="as-pkg-list"><div class="as-pkg-note">Reading the programs on ${esc(name)}...</div></div>
                <div class="as-pkg-status"></div>
            </div>`;
        document.body.appendChild(m);
        const q = (s) => m.querySelector(s);
        const v = { modal: m, list: [], selected: null, sort: 'label', dir: 1, system: false, icons: new Map(), closed: false, busy: false };
        open.set(deviceId, v);
        const say = (t) => { q('.as-pkg-status').textContent = t || ''; };

        function current() { return v.list.find((p) => p.package === v.selected) || null; }

        function buttons() {
            const p = current();
            const off = !p || v.busy;
            m.querySelectorAll('[data-pkg]').forEach((b) => {
                const k = b.dataset.pkg;
                if (k === 'refresh') { b.disabled = v.busy; return; }
                b.disabled = off || (k !== 'open' && p.protected);
                if (k === 'toggle') b.textContent = p && !p.enabled ? 'Enable' : 'Disable';
            });
        }

        function draw() {
            const cols = [['label', 'Name', '40%'], ['version', 'Version', '18%'], ['size', 'Size', '12%'], ['system', 'Type', '12%'], ['enabled', 'Status', '18%']];
            const rows = v.list.slice().sort((a, b) => {
                const x = a[v.sort]; const y = b[v.sort];
                const c = typeof x === 'number' || typeof x === 'boolean' ? (Number(x) - Number(y)) : String(x || '').localeCompare(String(y || ''), undefined, { sensitivity: 'base', numeric: true });
                return c * v.dir || String(a.label).localeCompare(String(b.label));
            });
            const head = cols.map(([k, t, w]) => `<th data-sort="${k}" style="width:${w}" class="${v.sort === k ? `is-sorted ${v.dir > 0 ? 'is-asc' : 'is-desc'}` : ''}">${t}</th>`).join('');
            const body = rows.map((p) => `<tr data-p="${esc(p.package)}" class="${p.package === v.selected ? 'is-selected' : ''}${p.enabled ? '' : ' is-disabled'}" title="${esc(p.package)}">
                <td><img alt="" src="${esc(v.icons.get(p.package) || `${ICONS}/item-32.png`)}">${esc(p.label)}</td>
                <td>${esc(p.version)}</td><td>${esc(bytes(p.size))}</td><td>${p.system ? 'System' : 'User'}</td><td>${p.enabled ? 'Enabled' : 'Disabled'}</td></tr>`).join('');
            q('.as-pkg-list').innerHTML = rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : '<div class="as-pkg-note">No programs.</div>';
            buttons();
            icons();
        }

        // icons for the rows on screen, a few at a time
        let iconRun = false;
        async function icons() {
            if (iconRun) return;
            iconRun = true;
            try {
                const box = q('.as-pkg-list');
                const want = Array.from(m.querySelectorAll('tr[data-p]')).filter((tr) => {
                    const r = tr.getBoundingClientRect(); const b = box.getBoundingClientRect();
                    return r.bottom > b.top - 200 && r.top < b.bottom + 200 && !v.icons.has(tr.dataset.p);
                }).map((tr) => tr.dataset.p).slice(0, 40);
                for (const pkg of want) {
                    if (v.closed) return;
                    try {
                        const r = await as.call(deviceId, 'apps.icon', { package: pkg, size: 32 }, { timeoutMs: 15000 });
                        if (r && r.icon) {
                            v.icons.set(pkg, r.icon);
                            const img = m.querySelector(`tr[data-p="${CSS.escape(pkg)}"] img`);
                            if (img) img.src = r.icon;
                        }
                    } catch (_) { v.icons.set(pkg, `${ICONS}/item-32.png`); }
                }
            } finally { iconRun = false; }
        }
        q('.as-pkg-list').addEventListener('scroll', () => { clearTimeout(v.scrollT); v.scrollT = setTimeout(icons, 150); });

        async function load() {
            v.busy = true; buttons(); say('Reading programs...');
            try {
                const r = await as.call(deviceId, 'apps.packages', { system: v.system }, { timeoutMs: 30000 });
                v.list = (r && Array.isArray(r.packages)) ? r.packages : [];
                if (v.selected && !current()) v.selected = null;
                const total = v.list.reduce((n, p) => n + (Number(p.size) || 0), 0);
                say(`${v.list.length} programs, ${bytes(total)}`);
            } catch (e) {
                v.list = [];
                q('.as-pkg-list').innerHTML = `<div class="as-pkg-note">${esc((e && e.message) || 'The programs could not be read.')}</div>`;
                say('');
                v.busy = false; buttons();
                return;
            }
            v.busy = false;
            draw();
        }

        const ASK = {
            uninstall: (p) => `Uninstall ${p.label}?${p.system ? ' It is a system program: it is removed for this user and stays in the phone\'s system image.' : ''}`,
            clear: (p) => `Clear all data of ${p.label}? Its settings, accounts and files are deleted.`,
            toggle: (p) => (p.enabled ? `Disable ${p.label}? It stops and disappears until it is enabled again.` : null)
        };

        async function act(kind) {
            const p = current();
            if (!p) return;
            const action = kind === 'toggle' ? (p.enabled ? 'disable' : 'enable') : kind;
            const ask = ASK[kind] && ASK[kind](p);
            if (ask) {
                const ok = typeof root.showConfirmationDialog === 'function'
                    ? await root.showConfirmationDialog(esc(ask), [{ text: 'Yes', value: true, className: 'btn-primary' }, { text: 'No', value: false, className: 'btn-secondary' }], null, { title: 'Package Management' }).catch(() => false)
                    : root.confirm(ask);
                if (!ok) return;
            }
            v.busy = true; buttons(); say(`${{ uninstall: 'Uninstalling', disable: 'Disabling', enable: 'Enabling', stop: 'Stopping', clear: 'Clearing', open: 'Opening' }[action]} ${p.label}...`);
            try {
                const r = await as.call(deviceId, 'apps.manage', { package: p.package, action }, { timeoutMs: 60000 });
                say(r && r.ok ? `${p.label}: done.` : `${p.label}: ${(r && r.output) || 'it did not work.'}`);
            } catch (e) {
                say(`${p.label}: ${(e && e.message) || 'it did not work.'}`);
            }
            v.busy = false;
            if (action !== 'open' && action !== 'stop') await load(); else buttons();
        }

        m.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (th) { const k = th.dataset.sort; v.dir = v.sort === k ? -v.dir : 1; v.sort = k; draw(); return; }
            const tr = e.target.closest('tr[data-p]');
            if (tr) {
                v.selected = tr.dataset.p;
                m.querySelectorAll('tr.is-selected').forEach((x) => x.classList.remove('is-selected'));
                tr.classList.add('is-selected');
                buttons();
                return;
            }
            const b = e.target.closest('[data-pkg]');
            if (b && !b.disabled) { if (b.dataset.pkg === 'refresh') load(); else act(b.dataset.pkg); }
        });
        m.addEventListener('dblclick', (e) => { if (e.target.closest('tr[data-p]')) act('open'); });
        q('[data-pkg-system]').addEventListener('change', (e) => { v.system = !!e.target.checked; load(); });

        const close = () => {
            if (v.closed) return;
            v.closed = true;
            open.delete(deviceId);
            document.removeEventListener('staticforge:modal-lifecycle', onLife);
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => m.remove(), 400);
        };
        m.querySelector('.close-btn').addEventListener('click', close);
        const onLife = (e) => { if (e && e.detail && e.detail.id === m.id && e.detail.type === 'closed') close(); };
        document.addEventListener('staticforge:modal-lifecycle', onLife);
        call('openModal', m);
        m.classList.remove('hidden');
        requestAnimationFrame(() => {
            if (m.hasAttribute('data-window-position-restored')) return;
            const r = m.getBoundingClientRect();
            call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
        });
        load();
        return v;
    }

    root.activeSyncPackages = { open: view };

    // Device Center > Programs and Services (melatonActiveSync.addTask, queued until it loads)
    const task = ['programs', {
        id: 'packages',
        text: 'Manage programs on your device',
        icon: 'add-programs-32.png',
        when: (dev) => !!(dev && dev.online && (dev.permissions || []).includes('control')),
        run: (dev) => { view(dev.deviceId); }
    }];
    const mas = root.melatonActiveSync;
    if (mas && typeof mas.addTask === 'function') mas.addTask(...task);
    else { root.melatonActiveSync = Object.assign(mas || {}, { pending: ((mas && mas.pending) || []).concat([task]) }); }
})(typeof window !== 'undefined' ? window : globalThis);
