/**
 * Control Panel's property sheets, second set (Yozora #632; cplDialogs.js has the engine and the
 * first set): Internet Properties, Offline Files, Tablet PC Settings, Pen and Input Devices,
 * iSCSI Initiator, Bluetooth Settings, Phone and Modem Options, People Near Me. Internet Explorer
 * is Grimoire here (its window says "<page> - Grimoire"), so its sheet does too; the home page is
 * Grimoire's own setting (userGlobalSettings.alchemy.homePage, grimoireRemoteBrowser.js).
 */
(function (root) {
    'use strict';

    const C = root.cplDialogs;
    if (!C) return;
    const { DIALOGS, KEY, reg, itemIcon, hardwareTab } = C;
    const doc = typeof document !== 'undefined' ? document : null;
    const V = () => root.vistaDialogTemplate;
    const R = () => root.melatonRegistry;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /** An item or page of Control Panel itself (melatonControlPanel.js doAction). */
    function openCpl(target) {
        const cp = root.melatonControlPanel;
        if (!cp) return;
        if (target === 'network') cp.open('network');
        else cp.doAction(`item:${target}`);
    }

    function grimoire(text) {
        return String(text || '').replace(/(?:<u>I<\/u>|I)nternet Explorer/g, (m) => (m.startsWith('<u>') ? '<u>G</u>rimoire' : 'Grimoire'));
    }

    /** Hide Vista's run-time-only controls (policy notes, alternates) in a page's overrides. */
    function hide(...ids) {
        const o = {};
        ids.forEach((id) => { o[id] = { hidden: true }; });
        return o;
    }

    function helpLinks(ctx, topic) {
        ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', () => callGlobal('openHelpAndSupport', topic)));
    }

    function listRows(lv, rows, cols) {
        if (!lv) return;
        if (cols) {
            lv.classList.add('is-report');
            lv.querySelector('.vdt-lv-header').innerHTML = cols.map((c) => `<span class="vdt-lv-col" style="width:${c.w}px">${esc(c.t)}</span>`).join('');
        }
        lv.querySelector('.vdt-lv-body').innerHTML = rows.map((r, i) => `<div class="vdt-lv-row${r.selected ? ' is-selected' : ''}" data-row="${i}">${r.cells.map((c, j) => `<span style="width:${cols ? cols[j].w : 200}px">${j === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(c)}</span>`).join('')}</div>`).join('');
    }

    // ---- Internet Properties -------------------------------------------------------------------

    const POLICY = [6200, 6201, 6202];
    const ZONES = [
        { id: 'internet', name: 'Internet', icon: '/static_images/vista-dlg/inetcpl-zone-internet.png', text: 'This zone is for Internet websites, except those listed in trusted and restricted zones.', level: 3 },
        { id: 'intranet', name: 'Local intranet', icon: '/static_images/vista-dlg/inetcpl-zone-intranet.png', text: 'This zone is for all websites that are found on your intranet.', level: 2 },
        { id: 'trusted', name: 'Trusted sites', icon: '/static_images/vista-dlg/inetcpl-zone-trusted.png', text: 'This zone contains websites that you trust not to damage your computer or your files.', level: 2 },
        { id: 'restricted', name: 'Restricted sites', icon: '/static_images/vista-dlg/inetcpl-zone-restricted.png', text: 'This zone is for websites that might damage your computer or your files.', level: 4 }
    ];
    const LEVELS = ['Low', 'Medium-low', 'Medium', 'Medium-high', 'High'];
    const LEVEL_TEXT = {
        Low: '- Minimal safeguards and warning prompts are provided\n- Most content is downloaded and run without prompts\n- All active content can run\n- Appropriate for websites that you absolutely trust',
        'Medium-low': '- Same as Medium without the prompts\n- Most content will be run without prompts\n- Unsigned ActiveX controls will not be downloaded\n- Appropriate for websites on your local network (intranet)',
        Medium: '- Prompts before downloading potentially unsafe content\n- Unsigned ActiveX controls will not be downloaded\n- Appropriate for most websites',
        'Medium-high': '- Appropriate for most websites\n- Prompts before downloading potentially unsafe content\n- Unsigned ActiveX controls will not be downloaded',
        High: '- Appropriate for websites that might have harmful content\n- Maximum safeguards\n- Less secure features are disabled'
    };
    const PRIVACY = ['Accept All Cookies', 'Low', 'Medium', 'Medium High', 'High', 'Block All Cookies'];
    const PRIVACY_TEXT = {
        'Accept All Cookies': '- Saves cookies from any website.\n- Cookies on this computer that are already set can be read by the websites that created them',
        Low: '- Restricts third-party cookies that do not have a compact privacy policy\n- Restricts third-party cookies that save information that can be used to contact you without your implicit consent',
        Medium: '- Blocks third-party cookies that do not have a compact privacy policy\n- Blocks third-party cookies that save information that can be used to contact you without your explicit consent\n- Restricts first-party cookies that save information that can be used to contact you without your implicit consent',
        'Medium High': '- Blocks third-party cookies that do not have a compact privacy policy\n- Blocks third-party cookies that save information that can be used to contact you without your explicit consent\n- Blocks first-party cookies that save information that can be used to contact you without your implicit consent',
        High: '- Blocks all cookies from websites that do not have a compact privacy policy\n- Blocks cookies that save information that can be used to contact you without your explicit consent',
        'Block All Cookies': '- Blocks all new cookies from all websites\n- Cookies already on this computer cannot be read by websites'
    };
    // Advanced: a few of Vista's groups, Windows -> Melaton, Internet Explorer -> Grimoire
    const INET_ADVANCED = [
        { group: 'Accessibility', items: [
            ['Always expand ALT text for images', 'ExpandAlt', false], ['Move system caret with focus/selection changes', 'MoveCaret', false],
            ['Reset text size to medium for new windows and tabs', 'ResetTextSize', false], ['Reset zoom level for new windows and tabs', 'ResetZoom', false]] },
        { group: 'Browsing', items: [
            ['Automatically check for Grimoire updates', 'CheckUpdates', true], ['Close unused folders in History and Favorites', 'CloseFolders', false],
            ['Disable script debugging (Grimoire)', 'DisableScriptDebuggerIE', true], ['Display a notification about every script error', 'ErrorDlgDisplayedOnEveryError', false],
            ['Enable automatic crash recovery', 'AutoRecover', true], ['Enable FTP folder view (outside of Grimoire)', 'FtpFolderView', true],
            ['Enable page transitions', 'PageTransitions', true], ['Enable Suggested Sites', 'SuggestedSites', false],
            ['Enable visual styles on buttons and controls in webpages', 'VisualStyles', true], ['Notify when downloads complete', 'NotifyDownloadComplete', true],
            ['Reuse windows for launching shortcuts (when tabbed browsing is off)', 'ReuseWindows', true], ['Show friendly HTTP error messages', 'FriendlyErrors', true],
            ['Underline links: Always', 'UnderlineLinks', true], ['Use inline AutoComplete', 'InlineAutoComplete', false],
            ['Use smooth scrolling', 'SmoothScroll', true]] },
        { group: 'Multimedia', items: [
            ['Enable automatic image resizing', 'ImageResizing', true], ['Play animations in webpages*', 'PlayAnimations', true],
            ['Play sounds in webpages', '@audioEnabled', true], ['Show image download placeholders', 'ShowPlaceholders', false],
            ['Show pictures', 'ShowPictures', true]] },
        { group: 'Security', items: [
            ['Allow active content to run in files on My Computer*', 'LocalActive', false], ['Check for publisher\'s certificate revocation', 'CheckRevocation', true],
            ['Do not save encrypted pages to disk', 'NoSaveEncrypted', false], ['Empty Temporary Internet Files folder when browser is closed', 'EmptyCache', false],
            ['Enable memory protection to help mitigate online attacks*', 'MemoryProtection', true], ['Enable native XMLHTTP support', 'XMLHTTP', true],
            ['Use SSL 3.0', 'SSL3', true], ['Use TLS 1.0', 'TLS10', true], ['Warn if changing between secure and not secure mode', 'WarnSecureChange', true]] }
    ];

    // "@name" rows are Alchemy's own settings (userGlobalSettings.alchemy), the rest registry values
    function inetTree(values, alchemy) {
        let n = 0;
        const io = root.cplInternetOptions;
        const value = (name, d) => {
            if (name[0] === '@') return alchemy && alchemy[name.slice(1)] !== undefined ? !!alchemy[name.slice(1)] : d;
            return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : d;
        };
        const groups = INET_ADVANCED.map((g) => [
            `<div class="tbp-tree-row is-node"><span>${esc(g.group)}</span></div>`,
            ...g.items.map(([t, name, d]) => {
                n += 1;
                return `<div class="tbp-tree-row is-child"><input type="checkbox" id="cpl-ia-${n}" data-ia="${name}"${value(name, d) ? ' checked' : ''}><label for="cpl-ia-${n}">${esc(t)}</label></div>`;
            })
        ].join(''));
        if (io && alchemy) {
            // Alchemy, the remote browser: its picture quality and frame rates (grimoireRemoteBrowser.js Tools ▾)
            groups.splice(1, 0, [`<div class="tbp-tree-row is-node"><span>Alchemy</span></div>`, ...io.ALCHEMY_ADVANCED.map((row) => {
                n += 1;
                if (row.check) return `<div class="tbp-tree-row is-child"><input type="checkbox" id="cpl-ia-${n}" data-ia="@${row.key}"${alchemy[row.key] ? ' checked' : ''}><label for="cpl-ia-${n}">${esc(row.check)}</label></div>`;
                return [`<div class="tbp-tree-row is-child cpl-fo-sub"><img src="/static_images/vista-icons/explorer/folder-16.png" alt="" onerror="this.remove()"><span>${esc(row.sub)}</span></div>`, ...row.choices.map(([v, label]) => {
                    n += 1;
                    return `<div class="tbp-tree-row is-child cpl-fo-radio"><input type="radio" name="cpl-ia-${row.key}" id="cpl-ia-${n}" data-ia-radio="${row.key}" value="${v}"${Number(alchemy[row.key]) === v ? ' checked' : ''}><label for="cpl-ia-${n}">${esc(label)}</label></div>`;
                })].join('');
            })].join(''));
        }
        return groups.join('');
    }

    DIALOGS['internet-options'] = {
        windowId: 'cplInternetProperties',
        title: 'Internet Properties',
        icon: itemIcon('internet-options'),
        tabs: { general: 'inetcpl:100', security: 'inetcpl:500', privacy: 'inetcpl:5300', content: 'inetcpl:4454', connections: 'inetcpl:200', programs: 'inetcpl:300', advanced: 'inetcpl:600' },
        pages: [
            { key: 'inetcpl:100', overrides: hide(...POLICY) },
            { key: 'inetcpl:500', overrides: { ...hide(...POLICY, 5601, 5602, 1575, 1579, 1030), 1518: { html: '<img class="cpl-zone-icon" alt="">' } } },
            { key: 'inetcpl:5300', overrides: hide(...POLICY) },
            { key: 'inetcpl:4454', overrides: hide(...POLICY) },
            { key: 'inetcpl:200', overrides: hide(...POLICY) },
            { key: 'inetcpl:300', overrides: { ...hide(...POLICY), 5904: { text: 'Grimoire is the default web browser.' }, 303: { text: 'Tell me if &Grimoire is not the default web browser.' } } },
            { key: 'inetcpl:600', overrides: { ...hide(...POLICY), 1439: { html: '', cls: 'tbp-tree cpl-ia-tree' } } }
        ],
        fields: [
            { page: 'inetcpl:500', id: 1534, key: KEY.inetZones, name: 'ProtectedMode', type: 'check', def: true },
            { page: 'inetcpl:5300', id: 5400, key: KEY.inetPrivacy, name: 'PopupMgr', type: 'check', def: true },
            { page: 'inetcpl:200', radios: { 1621: 0, 1622: 1, 1623: 2 }, key: KEY.inetZones, name: 'EnableAutodial', def: 0 },
            { page: 'inetcpl:300', id: 303, key: KEY.inet, name: 'Check_Associations', type: 'check', def: true },
            { page: 'inetcpl:300', id: 1610, key: KEY.inet, name: 'HTMLEditor', type: 'select', def: 'notepad', options: [{ value: 'notepad', text: 'Notepad' }, { value: 'wordpad', text: 'WordPad' }] }
        ],
        init(ctx) {
            // retitle Internet Explorer's strings
            ctx.content.querySelectorAll('.vdt-static, .vdt-check label span, .tbp-group-label').forEach((n) => {
                if (/Internet Explorer/.test(n.textContent)) n.innerHTML = grimoire(n.innerHTML);
            });
            // General: the home page tabs are Grimoire's home page
            // General: the home page tabs are Grimoire's home page (userGlobalSettings.alchemy.homePage;
            // empty is Grimoire's own start page, which "Use default" picks)
            const io = root.cplInternetOptions;
            const home = ctx.el(1487, 'inetcpl:100');
            ctx.store.home = '';
            ctx.store.alchemy = null;
            const fillAdv = (values, alchemy) => { ctx.holder(1439, 'inetcpl:600').innerHTML = inetTree(values, alchemy); };
            if (io) {
                io.alchemySettings().then((s) => {
                    ctx.store.alchemy = s;
                    ctx.store.home = (s && s.homePage) || '';
                    if (home) home.value = ctx.store.home || 'about:Home';
                    fillAdv(R() ? R().getKey(`${KEY.inet}\\Advanced`) : {}, s);
                }).catch(() => {});
            }
            ctx.on(1486, 'click', () => {
                const url = io ? io.currentPage() : '';
                if (url) { home.value = url; ctx.dirty(); }
            }, 'inetcpl:100');
            // Grimoire's own start page stands for both IE's default and its blank page
            ctx.on(1485, 'click', () => { home.value = 'about:Home'; ctx.dirty(); }, 'inetcpl:100');
            ctx.on(404, 'click', () => { home.value = 'about:blank'; ctx.dirty(); }, 'inetcpl:100');
            const sub = (id, page, name) => ctx.on(id, 'click', () => { if (io) io.open[name](ctx.modal); }, page);
            sub(5501, 'inetcpl:100', 'deleteHistory');
            sub(1490, 'inetcpl:100', 'historySettings');
            sub(5503, 'inetcpl:100', 'search');
            sub(5505, 'inetcpl:100', 'tabs');
            sub(1483, 'inetcpl:100', 'colors');
            sub(1495, 'inetcpl:100', 'languages');
            sub(1494, 'inetcpl:100', 'fonts');
            sub(1496, 'inetcpl:100', 'accessibility');
            sub(5319, 'inetcpl:5300', 'privacyAdvanced');
            sub(5401, 'inetcpl:5300', 'popups');
            sub(321, 'inetcpl:4454', 'autoComplete');
            sub(771, 'inetcpl:4454', 'feeds');
            sub(4865, 'inetcpl:300', 'addons');
            // Security: the zones list and the slider
            const lv = ctx.holder(1566, 'inetcpl:500');
            lv.classList.add('is-icons', 'cpl-zones');
            lv.querySelector('.vdt-lv-body').innerHTML = ZONES.map((z, i) => `<div class="vdt-lv-row${i === 0 ? ' is-selected' : ''}" data-zone="${z.id}"><img src="${z.icon}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(z.name)}</span></div>`).join('');
            ctx.store.levels = {};
            ZONES.forEach((z) => { ctx.store.levels[z.id] = reg(KEY.inetZones, `Zone${z.id}Level`, z.level); });
            const showZone = () => {
                const row = lv.querySelector('.vdt-lv-row.is-selected');
                const z = ZONES.find((x) => x.id === (row && row.dataset.zone)) || ZONES[0];
                ctx.store.zone = z.id;
                ctx.text(1576, z.name, 'inetcpl:500');
                ctx.text(1516, z.text, 'inetcpl:500');
                ctx.enable(1019, z.id !== 'internet', 'inetcpl:500');
                const img = ctx.page('inetcpl:500').querySelector('.cpl-zone-icon');
                if (img) img.src = z.icon;
                const lvl = ctx.store.levels[z.id];
                ctx.range(1567, 0, 4, 4 - lvl, 'inetcpl:500', 4);
                ctx.text(1578, LEVELS[lvl], 'inetcpl:500');
                ctx.text(1568, LEVEL_TEXT[LEVELS[lvl]], 'inetcpl:500');
            };
            lv.addEventListener('change', showZone);
            ctx.on(1567, 'input', () => {
                const lvl = 4 - Number(ctx.get(1567, 'inetcpl:500'));
                ctx.store.levels[ctx.store.zone] = lvl;
                ctx.text(1578, LEVELS[lvl], 'inetcpl:500');
                ctx.text(1568, LEVEL_TEXT[LEVELS[lvl]], 'inetcpl:500');
            }, 'inetcpl:500');
            ctx.on(1531, 'click', () => {
                const z = ZONES.find((x) => x.id === ctx.store.zone);
                ctx.store.levels[z.id] = z.level;
                showZone();
                ctx.dirty();
            }, 'inetcpl:500');
            ctx.on(5600, 'click', () => {
                ZONES.forEach((z) => { ctx.store.levels[z.id] = z.level; });
                showZone();
                ctx.dirty();
            }, 'inetcpl:500');
            showZone();
            // Privacy: the cookie slider
            ctx.store.privacy = reg(KEY.inetPrivacy, 'PrivacyLevel', 2);
            const showPrivacy = () => {
                const p = ctx.store.privacy;
                ctx.text(5333, PRIVACY[p], 'inetcpl:5300');
                ctx.text(1568, PRIVACY_TEXT[PRIVACY[p]], 'inetcpl:5300');
            };
            ctx.range(5334, 0, 5, 5 - ctx.store.privacy, 'inetcpl:5300', 5);
            ctx.on(5334, 'input', () => { ctx.store.privacy = 5 - Number(ctx.get(5334, 'inetcpl:5300')); showPrivacy(); }, 'inetcpl:5300');
            ctx.on(5318, 'click', () => { ctx.store.privacy = 2; ctx.range(5334, 0, 5, 3, 'inetcpl:5300', 5); showPrivacy(); ctx.dirty(); }, 'inetcpl:5300');
            showPrivacy();
            ctx.on(5802, 'click', () => openCpl('parental-controls'), 'inetcpl:4454');
            // Connections: Melaton's own VPN connection
            const tree = ctx.holder(1559, 'inetcpl:200');
            const conn = root.melatonNetworkDialogs ? root.melatonNetworkDialogs.connectionInfo().connectionName : 'VPN Connection';
            if (tree) tree.innerHTML = `<div class="tbp-tree-row is-node"><img src="/static_images/melaton/net-globe.png" alt="" width="16" height="16"><span>${esc(conn)} (Default)</span></div>`;
            ctx.text(1583, conn, 'inetcpl:200');
            ctx.on(1453, 'click', () => openCpl('network'), 'inetcpl:200');
            ctx.on(1580, 'click', () => openCpl('network'), 'inetcpl:200');
            ctx.on(5903, 'click', () => {}, 'inetcpl:300');
            ctx.enable(5903, false, 'inetcpl:300');
            // Advanced
            const adv = ctx.holder(1439, 'inetcpl:600');
            fillAdv(R() ? R().getKey(`${KEY.inet}\\Advanced`) : {}, ctx.store.alchemy);
            adv.addEventListener('change', () => ctx.dirty());
            // Restore advanced settings: every row to its default, Alchemy's included (it saves on Apply)
            ctx.on(1526, 'click', () => { fillAdv({}, io ? io.ALCHEMY_DEFAULTS : null); ctx.dirty(); }, 'inetcpl:600');
            ctx.on(6010, 'click', () => {
                if (io) io.open.reset(ctx.modal, () => { ctx.store.alchemy = { ...io.ALCHEMY_DEFAULTS }; ctx.store.home = ''; home.value = 'about:Home'; fillAdv({}, ctx.store.alchemy); });
            }, 'inetcpl:600');
            helpLinks(ctx, 'internet-options');
        },
        async apply(ctx) {
            const io = root.cplInternetOptions;
            const home = ctx.get(1487, 'inetcpl:100');
            const first = String(home || '').split(/\r?\n/)[0].trim();
            const url = /^about:(blank|home)$/i.test(first) ? '' : first;
            // Grimoire's settings: the home page and the Advanced rows marked "@"
            const patch = {};
            if (url !== ctx.store.home) patch.homePage = url;
            const tree = ctx.holder(1439, 'inetcpl:600');
            const was = ctx.store.alchemy || {};
            tree.querySelectorAll('[data-ia^="@"]').forEach((i) => {
                const k = i.dataset.ia.slice(1);
                if (!!was[k] !== i.checked) patch[k] = i.checked;
            });
            tree.querySelectorAll('[data-ia-radio]:checked').forEach((i) => {
                const k = i.dataset.iaRadio;
                if (Number(was[k]) !== Number(i.value)) patch[k] = Number(i.value);
            });
            if (patch.minFps && patch.maxFps === undefined && patch.minFps > Number(was.maxFps)) patch.maxFps = patch.minFps;
            if (io && Object.keys(patch).length) {
                try {
                    const saved = await io.saveAlchemy(patch);
                    if (saved) { ctx.store.alchemy = { ...was, ...saved }; ctx.store.home = saved.homePage || ''; }
                } catch (err) { console.error('Internet Properties: Grimoire settings', err); }
            }
            const r = R();
            if (!r) return;
            const zones = {};
            ZONES.forEach((z) => { zones[`Zone${z.id}Level`] = ctx.store.levels[z.id]; });
            const adv = {};
            tree.querySelectorAll('[data-ia]:not([data-ia^="@"])').forEach((i) => { adv[i.dataset.ia] = i.checked; });
            await Promise.all([
                r.set(KEY.inetZones, zones),
                r.set(KEY.inetPrivacy, { PrivacyLevel: ctx.store.privacy }),
                r.set(`${KEY.inet}\\Advanced`, adv)
            ]);
        }
    };

    // ---- Offline Files ---------------------------------------------------------------------------

    DIALOGS['offline-files'] = {
        windowId: 'cplOfflineFiles',
        title: 'Offline Files',
        icon: itemIcon('offline-files'),
        tabs: { general: 'cscui:1358', disk: 'cscui:1359', encryption: 'cscui:1360', network: 'cscui:1361' },
        pages: [
            { key: 'cscui:1358' },
            { key: 'cscui:1359' },
            { key: 'cscui:1360', overrides: hide(2221, 2222, 2223, 2214, 2213) },
            { key: 'cscui:1361' }
        ],
        fields: [
            { page: 'cscui:1361', id: 2226, key: KEY.csc, name: 'SlowLinkEnabled', type: 'check', def: true },
            { page: 'cscui:1361', id: 2227, key: KEY.csc, name: 'SlowLinkMinutes', type: 'num', def: 5 }
        ],
        init(ctx) {
            const enabled = () => reg(KEY.csc, 'Enabled', true);
            const showGeneral = () => {
                const on = ctx.store.enabled;
                ctx.text(2235, on ? 'Offline Files is enabled.' : 'Offline Files is disabled.', 'cscui:1358');
                ctx.enable(2233, !on, 'cscui:1358');
                ctx.enable(2234, on, 'cscui:1358');
            };
            ctx.store.enabled = enabled();
            showGeneral();
            ctx.on(2233, 'click', () => { ctx.store.enabled = true; showGeneral(); ctx.dirty(); }, 'cscui:1358');
            ctx.on(2234, 'click', () => { ctx.store.enabled = false; showGeneral(); ctx.dirty(); }, 'cscui:1358');
            ctx.on(2212, 'click', () => openCpl('sync-center'), 'cscui:1358');
            ctx.on(2214, 'click', () => callGlobal('openExplorerApplet'), 'cscui:1358');
            // Disk Usage: the browser's storage quota stands in for the disk
            const est = root.navigator.storage && root.navigator.storage.estimate ? root.navigator.storage.estimate() : Promise.resolve(null);
            est.then((e) => {
                if (!e) return;
                const gb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
                const pct = e.quota ? Math.min(100, Math.round((e.usage / e.quota) * 100)) : 0;
                ctx.text(2238, `${gb(e.usage || 0)} in use (${gb(Math.max(0, (e.quota || 0) - (e.usage || 0)))} available)`, 'cscui:1359');
                ctx.text(2242, `${gb(e.quota || 0)} limit`, 'cscui:1359');
                ctx.text(2245, `(${pct}% of browser storage)`, 'cscui:1359');
                const f = ctx.holder(2138, 'cscui:1359');
                if (f) f.querySelector('.vdt-progress-fill').style.setProperty('--vdt-progress', `${pct}%`);
                ctx.text(2243, `0 MB in use (${gb(Math.max(0, (e.quota || 0) - (e.usage || 0)))} available)`, 'cscui:1359');
                ctx.text(2244, `${gb(e.quota || 0)} limit`, 'cscui:1359');
                ctx.text(2246, `(${pct}% of browser storage)`, 'cscui:1359');
            }).catch(() => {});
            ctx.store.encrypted = reg(KEY.csc, 'EncryptOfflineFiles', false);
            const showEnc = () => {
                ctx.text(2218, ctx.store.encrypted ? 'Your offline files are encrypted.' : 'You can encrypt your offline files to help protect them from unauthorized access.', 'cscui:1360');
                ctx.enable(2229, !ctx.store.encrypted, 'cscui:1360');
                ctx.show(2213, ctx.store.encrypted, 'cscui:1360');
                ctx.show(2229, !ctx.store.encrypted, 'cscui:1360');
            };
            showEnc();
            ctx.on(2229, 'click', () => { ctx.store.encrypted = true; showEnc(); ctx.dirty(); }, 'cscui:1360');
            ctx.on(2213, 'click', () => { ctx.store.encrypted = false; showEnc(); ctx.dirty(); }, 'cscui:1360');
            ctx.text(2231, 'Melaton reaches the server through the domain network connection. When it is slow, Cartograph works from its cache until the connection is fast again.', 'cscui:1361');
            const ud = ctx.holder(2159, 'cscui:1361');
            if (ud) { ud.dataset.min = '1'; ud.dataset.max = '60'; }
            helpLinks(ctx, 'offline-files');
        },
        async apply(ctx) {
            if (R()) await R().set(KEY.csc, { Enabled: ctx.store.enabled, EncryptOfflineFiles: ctx.store.encrypted });
        }
    };

    // ---- Tablet PC Settings / Pen and Input Devices ----------------------------------------------

    const MANAGED = hide(12001, 12002, 12003, 12004, 22015, 22014, 11839, 11840);

    DIALOGS['tablet-pc'] = {
        windowId: 'cplTabletPcSettings',
        title: 'Tablet PC Settings',
        icon: itemIcon('tablet-pc-settings'),
        tabs: { general: 'tabletpc:21000', handwriting: 'tabletpc:22000', display: 'tabletpc:11001', other: 'tabletpc:23000' },
        pages: [{ key: 'tabletpc:21000' }, { key: 'tabletpc:22000', overrides: MANAGED }, { key: 'tabletpc:11001' }, { key: 'tabletpc:23000' }],
        fields: [
            { page: 'tabletpc:21000', radios: { 21001: 'right', 21002: 'left' }, key: KEY.tablet, name: 'Handedness', def: 'right' },
            { page: 'tabletpc:21000', id: 21006, key: KEY.tablet, name: 'CalibrationOrientation', type: 'select', def: 'Primary landscape', options: ['Primary landscape', 'Secondary portrait', 'Secondary landscape', 'Primary portrait'] },
            { page: 'tabletpc:22000', id: 22003, key: KEY.tablet, name: 'PersonalizedRecognizer', type: 'check', def: true },
            { page: 'tabletpc:22000', radios: { 22006: true, 22007: false }, key: KEY.tablet, name: 'AutomaticLearning', def: true },
            { page: 'tabletpc:11001', id: 11301, key: KEY.tablet, name: 'Orientation', type: 'select', def: 'Primary landscape', options: ['Primary landscape', 'Secondary portrait', 'Secondary landscape', 'Primary portrait'] }
        ],
        init(ctx) {
            ctx.on(21007, 'click', () => {}, 'tabletpc:21000');
            ctx.content.querySelectorAll('.vdt-link').forEach((a) => a.addEventListener('click', (ev) => {
                const id = a.dataset.link;
                if (/pen/i.test(a.textContent)) C.open('pen-and-input', null, ctx.modal);
                else if (id === 'idWinmobcenter') openCpl('power-options');
                else callGlobal('openHelpAndSupport', 'tablet-pc');
                ev.preventDefault();
            }));
        }
    };

    const PEN_ACTIONS = [
        ['Single-tap', 'Single-click'], ['Double-tap', 'Double-click'], ['Press and hold', 'Right-click'],
        ['Start Tablet PC Input Panel', 'Show Input Panel'], ['Hover', 'Point']
    ];

    DIALOGS['pen-and-input'] = {
        windowId: 'cplPenAndInput',
        title: 'Pen and Input Devices',
        icon: itemIcon('pen-and-input-devices'),
        tabs: { pen: 'tabletpc:11006', pointer: 'tabletpc:24000', flicks: 'tabletpc:25000' },
        pages: [{ key: 'tabletpc:11006' }, { key: 'tabletpc:24000', overrides: MANAGED }, { key: 'tabletpc:25000', overrides: { ...MANAGED, 25010: { html: '<img src="/static_images/vista-dlg/tabletpc-flicks.png" alt="" onerror="this.remove()">' } } }],
        fields: [
            { page: 'tabletpc:11006', id: 11405, key: KEY.pen, name: 'RightMaskEnabled', type: 'check', def: true },
            { page: 'tabletpc:11006', id: 11406, key: KEY.pen, name: 'EraseEnable', type: 'check', def: true },
            { page: 'tabletpc:24000', id: 24001, key: KEY.pen, name: 'FeedbackSingleTap', type: 'check', def: true },
            { page: 'tabletpc:24000', id: 24002, key: KEY.pen, name: 'FeedbackDoubleTap', type: 'check', def: true },
            { page: 'tabletpc:24000', id: 24003, key: KEY.pen, name: 'FeedbackPenButton', type: 'check', def: true },
            { page: 'tabletpc:24000', id: 24004, key: KEY.pen, name: 'FeedbackPenButtonTap', type: 'check', def: true },
            { page: 'tabletpc:24000', id: 24007, key: KEY.pen, name: 'PenCursors', type: 'check', def: true },
            { page: 'tabletpc:25000', id: 25002, key: KEY.pen, name: 'FlicksEnabled', type: 'check', def: true },
            { page: 'tabletpc:25000', radios: { 25004: 'nav', 25005: 'edit' }, key: KEY.pen, name: 'FlickMode', def: 'nav' },
            { page: 'tabletpc:25000', id: 25007, key: KEY.pen, name: 'FlickTolerance', type: 'range', min: 0, max: 6, def: 3, ticks: 6 },
            { page: 'tabletpc:25000', id: 25008, key: KEY.pen, name: 'FlickIcon', type: 'check', def: true }
        ],
        init(ctx) {
            ctx.show(25003, false, 'tabletpc:25000');
            ctx.show(11838, false, 'tabletpc:25000');
            ctx.show(25012, false, 'tabletpc:25000');
            listRows(ctx.holder(11400, 'tabletpc:11006'), PEN_ACTIONS.map(([a, b], i) => ({ cells: [a, b], selected: i === 0 })), [{ t: 'Pen action', w: 150 }, { t: 'Equivalent mouse action', w: 160 }]);
            const sync = () => [25004, 25005, 25006].forEach((id) => ctx.enable(id, ctx.get(25002, 'tabletpc:25000'), 'tabletpc:25000'));
            ctx.on(25002, 'change', sync, 'tabletpc:25000');
            sync();
            helpLinks(ctx, 'pen-and-input');
        }
    };

    // ---- iSCSI Initiator -----------------------------------------------------------------------

    DIALOGS.iscsi = {
        windowId: 'cplIscsiInitiator',
        title: 'iSCSI Initiator Properties',
        icon: itemIcon('iscsi-initiator'),
        pages: [{ key: 'iscsicpl:136' }, { key: 'iscsicpl:127' }, { key: 'iscsicpl:128' }, { key: 'iscsicpl:109' }, { key: 'iscsicpl:124' }, { key: 'iscsicpl:144' }],
        init(ctx) {
            const host = (root.location && root.location.hostname) || 'melaton';
            const name = reg(KEY.iscsi, 'InitiatorName', `iqn.1991-05.jp.dreamscape:${host}`);
            ctx.set(1145, name, 'iscsicpl:136');
            ctx.el(1145, 'iscsicpl:136').readOnly = true;
            ctx.on(1127, 'click', async () => {
                const next = callGlobal('prompt', 'New initiator name:', ctx.get(1145, 'iscsicpl:136'));
                if (next) { ctx.set(1145, next.trim(), 'iscsicpl:136'); ctx.dirty(); }
            }, 'iscsicpl:136');
            const cols = (a, b) => [{ t: a, w: 130 }, { t: b, w: 200 }];
            listRows(ctx.holder(1100, 'iscsicpl:127'), [], cols('Address', 'Port'));
            listRows(ctx.holder(1105, 'iscsicpl:127'), [], cols('Name', ''));
            listRows(ctx.holder(1109, 'iscsicpl:128'), [], cols('Name', 'Status'));
            listRows(ctx.holder(11401, 'iscsicpl:109'), [], cols('Name', ''));
            listRows(ctx.holder(1085, 'iscsicpl:124'), [], cols('Volume/mount point/device', ''));
            listRows(ctx.holder(1157, 'iscsicpl:144'), [], [{ t: 'Server', w: 120 }]);
            helpLinks(ctx, 'iscsi');
        },
        async apply(ctx) {
            if (R()) await R().set(KEY.iscsi, { InitiatorName: ctx.get(1145, 'iscsicpl:136') });
        }
    };

    // ---- Bluetooth Settings ----------------------------------------------------------------------

    DIALOGS.bluetooth = {
        windowId: 'cplBluetoothSettings',
        title: 'Bluetooth Settings',
        icon: itemIcon('bluetooth-devices'),
        tabs: { options: 'bthprops:135', com: 'bthprops:132', hardware: 'bthprops:134' },
        pages: [{ key: 'bthprops:135' }, { key: 'bthprops:132', overrides: hide(1056) }, { key: 'bthprops:134' }],
        fields: [
            { page: 'bthprops:135', id: 1075, key: KEY.bth, name: 'Discoverable', type: 'check', def: false },
            { page: 'bthprops:135', id: 1076, key: KEY.bth, name: 'AllowConnections', type: 'check', def: true },
            { page: 'bthprops:135', id: 1077, key: KEY.bth, name: 'AlertNewDevice', type: 'check', def: true },
            { page: 'bthprops:135', id: 1100, key: KEY.bth, name: 'ShowTrayIcon', type: 'check', def: true },
            { page: 'bthprops:135', id: 1110, key: KEY.bth, name: 'AdapterOff', type: 'check', def: false }
        ],
        init(ctx) {
            listRows(ctx.holder(1036, 'bthprops:132'), [], [{ t: 'Port', w: 60 }, { t: 'Direction', w: 80 }, { t: 'Name', w: 150 }]);
            ctx.on(1096, 'click', () => {
                [1075, 1110].forEach((id) => ctx.set(id, false, 'bthprops:135'));
                [1076, 1077, 1100].forEach((id) => ctx.set(id, true, 'bthprops:135'));
                ctx.dirty();
            }, 'bthprops:135');
            helpLinks(ctx, 'bluetooth');
        }
    };

    // ---- Phone and Modem Options -----------------------------------------------------------------

    function countries() {
        let dn = null;
        try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) { /* codes */ }
        return 'AR AU AT BE BR CA CL CN CO CZ DK EG FI FR DE GR HK HU IN ID IE IL IT JP KR MY MX NL NZ NO PE PH PL PT RO RU SA SG ZA ES SE CH TW TH TR UA AE GB US VN'.split(' ')
            .map((c) => ({ value: c, text: dn ? dn.of(c) : c })).sort((a, b) => a.text.localeCompare(b.text));
    }

    DIALOGS['phone-and-modem'] = {
        plain: true,
        open(tab, owner) {
            // the first time, Vista asks for the location first (tapiui Location Information)
            if (!reg(KEY.telephony, 'Country', '')) return openLocationInfo(owner, () => phoneSheet(tab, owner));
            return phoneSheet(tab, owner);
        }
    };

    function openLocationInfo(owner, next) {
        return V().openDialog({
            id: 'cplLocationInformation',
            key: 'tapiui:115',
            icon: itemIcon('phone-and-modem-options'),
            owner,
            init(ctx) {
                ctx.options(1006, countries(), ((root.navigator && root.navigator.language) || 'en-US').split('-').pop());
                ctx.set(1036, true);
            },
            async ok(ctx) {
                const code = String(ctx.get(1034) || '').trim();
                if (!/^\d{1,8}$/.test(code)) {
                    callGlobal('showConfirmationDialog', 'Please enter a valid area code.', [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Location Information' });
                    return false;
                }
                if (R()) await R().set(KEY.telephony, { Name: 'My Location', Country: ctx.get(1006), AreaCode: code, CarrierCode: ctx.get(1058) || '', OutsideAccess: ctx.get(1010) || '', Pulse: !!ctx.get(1037) });
                setTimeout(next, 0);
                return true;
            }
        });
    }

    function phoneSheet(tab, owner) {
        return C.sheet({
            windowId: 'cplPhoneAndModem',
            title: 'Phone and Modem Options',
            icon: itemIcon('phone-and-modem-options'),
            pages: [{ key: 'tapiui:101' }, { key: 'tapiui:113', title: 'Advanced' }],
            init(ctx) {
                const name = reg(KEY.telephony, 'Name', 'My Location');
                const area = reg(KEY.telephony, 'AreaCode', '');
                listRows(ctx.holder(1033, 'tapiui:101'), [{ cells: [name, `Area code: ${area}`], selected: true, icon: '/static_images/vista-cpl/items/phone-and-modem-options-16.png' }], [{ t: 'Location', w: 200 }, { t: 'Area Code', w: 140 }]);
                ctx.text(1053, `${area ? `(${area}) ` : ''}555-0100`, 'tapiui:101');
                ctx.on(1031, 'click', () => openLocationInfo(ctx.modal, () => {}), 'tapiui:101');
                ctx.enable(1032, false, 'tapiui:101');
                ctx.options(1033, ['Microsoft HID Phone TSP', 'Microsoft Multicast Conference TSP', 'NDIS Proxy TAPI Service Provider', 'TAPI Kernel-Mode Service Provider', 'Unimodem 5 Service Provider'].map((t) => t.replace('Microsoft', 'Xyridian')), undefined, 'tapiui:113');
            }
        }, tab, owner);
    }

    // ---- People Near Me --------------------------------------------------------------------------

    DIALOGS['people-near-me'] = {
        plain: true,
        open(tab, owner) {
            return V().openDialog({
                id: 'cplPeopleNearMe',
                key: 'p2pcollab:8000',
                icon: itemIcon('people-near-me'),
                owner,
                // BS_OWNERDRAW buttons p2pcollab paints as links; 8006 is the white band behind the heading
                overrides: {
                    8012: { html: '<button type="button" class="tbp-link vdt-link">Read the full privacy statement online</button>', cls: 'tbp-link-row' },
                    8009: { html: '<button type="button" class="tbp-link vdt-link">What is a trusted contact?</button>', cls: 'tbp-link-row' }
                },
                init(ctx) {
                    const accounts = root.meletonAccounts;
                    const user = (accounts && typeof accounts.displayName === 'function' && accounts.displayName()) || (root.localStorage && root.localStorage.getItem('username')) || 'User';
                    ctx.set(8002, reg(KEY.p2p, 'DisplayName', user));
                    ctx.set(8013, reg(KEY.p2p, 'AutoSignIn', false));
                    ctx.options(8015, ['Anyone', 'Trusted contacts', 'No one'], reg(KEY.p2p, 'Invitations', 'Trusted contacts'));
                    ctx.set(8003, 'Your display name, your computer name and IP address, and the other information you choose to publish are visible to the people on your network while you are signed in to People Near Me.');
                    ctx.el(8003).readOnly = true;
                    ctx.on(8012, 'click', () => callGlobal('openHelpAndSupport', 'people-near-me'));
                    ctx.on(8009, 'click', () => callGlobal('openHelpAndSupport', 'people-near-me'));
                },
                async ok(ctx) {
                    if (R()) await R().set(KEY.p2p, { DisplayName: String(ctx.get(8002) || '').slice(0, 63), AutoSignIn: !!ctx.get(8013), Invitations: ctx.get(8015) });
                }
            });
        }
    };


    // ---- Add Hardware (Wizard97: hdwwiz's pages, Welcome -> what to do -> search -> finish) -----

    function openAddHardware(owner) {
        const T = root.vistaDialogTemplates || {};
        const steps = ['hdwwiz:200', 'hdwwiz:210', 'hdwwiz:211', 'hdwwiz:213'];
        const titles = { 'hdwwiz:210': ['The wizard can help you install other hardware', ''], 'hdwwiz:211': ['The wizard is searching for hardware', ''] };
        // the frame: 317 x 193 DLU of page above the button row (Wizard97), MS Shell Dlg 8
        const frame = { t: 'Add Hardware', w: 331, h: 220, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 0, 193, 331, 1, 0x50000010, '', 0],
            [12321, 'B', 160, 200, 50, 14, 0x50010000, '< &Back', 0],
            [12324, 'B', 210, 200, 50, 14, 0x50010001, '&Next >', 0],
            [2, 'B', 270, 200, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        let at = 0;
        let ctxRef = null;
        const show = () => {
            const key = steps[at];
            const tpl = T[key];
            const body = ctxRef.content.querySelector('.cpl-wiz-body');
            const exterior = tpl.h > 150;
            const hdr = titles[key];
            body.className = `cpl-wiz-body ${exterior ? 'is-exterior' : 'is-interior'}`;
            body.innerHTML = `${exterior ? '<div class="cpl-wiz-watermark"></div>' : `<div class="cpl-wiz-header"><b>${esc((hdr && hdr[0]) || '')}</b><span>${esc((hdr && hdr[1]) || '')}</span><img src="/static_images/vista-cpl/items/add-hardware-32.png" alt=""></div>`}
                <div class="cpl-wiz-page">${V().renderControls(tpl, `cplAddHw-${at}`, { module: 'hdwwiz', overrides: { 502: { image: '/static_images/vista-icons/info-16.png' }, 312: { text: at === 3 ? 'Melaton found no new hardware. The devices this computer uses are listed in Device Manager.' : '' } } })}</div>`;
            if (exterior) body.querySelector('[data-vdt-id="300"]').classList.add('cpl-wiz-title');
            ctxRef.enable(12321, at > 0 && at < 3);
            ctxRef.text(12324, at === 3 ? 'Finish' : 'Next >');
            ctxRef.enable(2, at < 3);
            if (key === 'hdwwiz:211') {
                // "searching": the browser's own device list stands in for the hardware scan
                let pct = 0;
                const bar = body.querySelector('[data-vdt-id="321"] .vdt-progress-fill');
                const tick = setInterval(() => {
                    pct += 12;
                    if (bar) bar.style.setProperty('--vdt-progress', `${Math.min(100, pct)}%`);
                    if (pct >= 100) { clearInterval(tick); at = 3; show(); }
                }, 180);
                ctxRef.enable(12324, false);
            } else ctxRef.enable(12324, true);
        };
        return V().openDialog({
            id: 'cplAddHardware',
            tpl: frame,
            icon: itemIcon('add-hardware'),
            owner,
            buttons: {
                12321: () => { if (at > 0) { at = at === 3 ? 1 : at - 1; show(); } },
                12324: (ctx) => { if (at === 3) ctx.close(); else { at += 1; show(); } }
            },
            init(ctx) {
                ctxRef = ctx;
                ctx.content.insertAdjacentHTML('afterbegin', '<div class="cpl-wiz-body"></div>');
                show();
            }
        });
    }

    DIALOGS['add-hardware'] = { plain: true, open: (tab, owner) => openAddHardware(owner) };

    // ---- Color Management (Vista draws it itself; laid out on Vista's 252 x 218 sheet grid) -------

    const CM = 'HKCU\\Software\\Xyridian\\Melaton NT\\CurrentVersion\\ICM';
    const CM_TPL = {
        devices: { t: 'Devices', w: 252, h: 218, f: ['Segoe UI', 9], c: [
            [-1, 'S', 7, 7, 30, 8, 0x50020000, 'De&vice:', 0],
            [100, 'C', 40, 5, 205, 60, 0x50210003, '', 0],
            [101, 'B', 40, 21, 205, 10, 0x50010003, '&Use my settings for this device', 0],
            [102, 'B', 175, 34, 70, 12, 0x50010000, '&Identify monitors', 0],
            [-1, 'S', 7, 52, 238, 8, 0x50020000, 'Profiles associated with this device:', 0],
            [103, 'SysListView32', 7, 62, 238, 110, 0x50810001, '', 0],
            [104, 'B', 7, 178, 50, 13, 0x50010000, '&Add...', 0],
            [105, 'B', 61, 178, 50, 13, 0x50010000, '&Remove', 0],
            [106, 'B', 150, 178, 95, 13, 0x50010000, '&Set as Default Profile', 0],
            [107, 'B', 7, 198, 238, 10, 0x50010000, '&Profiles', 0]
        ] },
        all: { t: 'All Profiles', w: 252, h: 218, f: ['Segoe UI', 9], c: [
            [200, 'SysListView32', 7, 7, 238, 165, 0x50810001, '', 0],
            [201, 'B', 7, 178, 50, 13, 0x50010000, '&Add...', 0],
            [202, 'B', 61, 178, 50, 13, 0x50010000, '&Remove', 0]
        ] },
        advanced: { t: 'Advanced', w: 252, h: 218, f: ['Segoe UI', 9], c: [
            [-1, 'B', 7, 5, 238, 60, 0x50000007, 'Melaton Color System Defaults', 0],
            [-1, 'S', 14, 19, 90, 8, 0x50020000, 'Device profile:', 0],
            [300, 'C', 105, 17, 133, 60, 0x50210003, '', 0],
            [-1, 'S', 14, 35, 90, 8, 0x50020000, 'Rendering intent:', 0],
            [301, 'C', 105, 33, 133, 60, 0x50210003, '', 0],
            [-1, 'B', 7, 70, 238, 40, 0x50000007, 'Display Calibration', 0],
            [302, 'B', 14, 85, 100, 13, 0x50010000, '&Calibrate display', 0],
            [303, 'B', 7, 116, 238, 10, 0x50010003, 'Use Melaton display calibration', 0]
        ] }
    };

    DIALOGS['color-management'] = {
        plain: true,
        open(tab, owner) {
            const T = root.vistaDialogTemplates;
            T['cm:devices'] = CM_TPL.devices;
            T['cm:all'] = CM_TPL.all;
            T['cm:advanced'] = CM_TPL.advanced;
            const tabs = { devices: 'cm:devices', all: 'cm:all', advanced: 'cm:advanced' };
            const profiles = ['sRGB IEC61966-2.1', 'Display P3', 'Adobe RGB (1998)'];
            const screenName = () => {
                const s = root.screen || {};
                return `1. Generic PnP Monitor - ${s.width || 0} x ${s.height || 0}${root.devicePixelRatio && root.devicePixelRatio !== 1 ? ` @ ${root.devicePixelRatio}x` : ''}`;
            };
            return C.sheet({
                windowId: 'cplColorManagement',
                title: 'Color Management',
                icon: itemIcon('color-management'),
                noApply: true,
                tabs,
                pages: [{ key: 'cm:devices' }, { key: 'cm:all' }, { key: 'cm:advanced' }],
                fields: [
                    { page: 'cm:devices', id: 101, key: CM, name: 'UsePerUserProfiles', type: 'check', def: false },
                    { page: 'cm:advanced', id: 300, key: CM, name: 'DefaultProfile', type: 'select', def: profiles[0], options: profiles },
                    { page: 'cm:advanced', id: 301, key: CM, name: 'RenderingIntent', type: 'select', def: 'Perceptual (photo images)', options: ['Perceptual (photo images)', 'Relative Colorimetric (line art)', 'Saturation (charts and graphs)', 'Absolute Colorimetric (simulate paper)'] },
                    { page: 'cm:advanced', id: 303, key: CM, name: 'CalibrationManagement', type: 'check', def: false }
                ],
                init(ctx) {
                    ctx.options(100, [screenName()], undefined, 'cm:devices');
                    // the display's real gamut: the browser says whether it shows P3
                    const p3 = root.matchMedia && root.matchMedia('(color-gamut: p3)').matches;
                    listRows(ctx.holder(103, 'cm:devices'), [{ cells: [p3 ? 'Display P3 (default)' : 'sRGB IEC61966-2.1 (default)', p3 ? 'display-p3.icc' : 'sRGB Color Space Profile.icm'], selected: true }], [{ t: 'Name', w: 220 }, { t: 'File name', w: 160 }]);
                    listRows(ctx.holder(200, 'cm:all'), profiles.map((pr, i) => ({ cells: [pr, i === 0 ? 'sRGB Color Space Profile.icm' : `${pr.replace(/\W+/g, '')}.icc`], selected: i === 0 })), [{ t: 'Name', w: 220 }, { t: 'File name', w: 160 }]);
                    ctx.on(102, 'click', () => {
                        const n = doc.createElement('div');
                        n.className = 'cpl-identify-monitor';
                        n.textContent = '1';
                        doc.body.appendChild(n);
                        setTimeout(() => n.remove(), 2000);
                    }, 'cm:devices');
                    ctx.on(302, 'click', () => openHelpTopic('calibrate'), 'cm:advanced');
                }
            }, tab, owner);
        }
    };

    function openHelpTopic(topic) {
        callGlobal('openHelpAndSupport', topic);
    }

    void hardwareTab;
})(typeof window !== 'undefined' ? window : globalThis);
