/**
 * Control Panel's System page (Yukimi 2026-10-21: "a System page in control panel with real
 * information"): Vista's Control Panel > System ("View basic information about your computer"),
 * laid out from the VM (systemcpl.dll UIFILE 1001 and a 1:1 capture).
 *
 *   Windows edition     the product, copyright and service pack (or build) from the shared version
 *                       source (window.getMeletonVersionInfo / loadMeletonVersionInfo, modalUtils.js),
 *                       the edition logo on the right (shellbrd.dll bitmap 1050)
 *   System              Rating: this browser session's Melaton Experience Index (experienceIndex.js:
 *                       performance and supported features, the base score is the lowest subscore);
 *                       the server host from get_system_info: processor and rated clock, memory,
 *                       system type = the server's architecture (host.* from modules/globalResources.js
 *                       refreshSystemInfoCache)
 *   Computer name...    the host name, the full name the client reaches it by, the workspace as the
 *                       description and the domain (Change settings = Customize network)
 *   Session             this client: who is signed in, the browser, the device (navigator) and the
 *                       client version
 *   Windows activation  the NovelAI account (optionsData.user): activated when there is one, and the
 *                       Product ID is derived from it; without an account Melaton is not activated
 *
 * The task pane links go to the Melaton analogues (Management Tools, Remote Access Properties,
 * Windows Defender, Runes).
 */
(function (root) {
    'use strict';

    const ART = '/static_images/vista-cpl';
    let registered = false;
    let main = null;
    let versionInfo = null;
    let systemInfo = null;
    let loadFailed = false;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function ws() {
        return root.wsClient || null;
    }

    function cpl() {
        return root.melatonControlPanel || null;
    }

    // ---- facts --------------------------------------------------------------------------------

    /** StrFormatByteSize as Vista's System page prints memory: three digits, truncated ("4.00 GB"). */
    function formatMemory(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '';
        const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
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

    function formatClock(mhz) {
        const n = Number(mhz);
        return Number.isFinite(n) && n > 0 ? `${(n / 1000).toFixed(2)} GHz` : '';
    }

    /** The server's architecture (Node's os.arch()) in Vista's words; ARM says so. */
    function systemType(arch) {
        if (!arch) return '';
        if (arch === 'x64') return '64-bit Operating System';
        if (arch === 'arm64') return '64-bit Operating System (ARM64)';
        if (/^(ia32|x86|i[3-6]86)$/.test(arch)) return '32-bit Operating System';
        if (arch === 'arm') return '32-bit Operating System (ARM)';
        if (/64/.test(arch)) return `64-bit Operating System (${arch})`;
        return `${arch} Operating System`;
    }

    /** The host as get_system_info reports it; servers from before host.* fall back to cpu / ram. */
    function hostFacts(sys) {
        const host = (sys && sys.host) || {};
        const cpuText = sys && typeof sys.cpu === 'string' ? sys.cpu.replace(/\s*\(\d+ cores\)\s*$/, '') : '';
        return {
            processor: host.cpuModel || (cpuText && cpuText !== 'Unknown' ? cpuText : ''),
            clock: formatClock(host.cpuMHz),
            memory: formatMemory(host.totalMemBytes) || (sys && sys.ram ? sys.ram : ''),
            type: systemType(host.arch),
            hostname: host.hostname || ''
        };
    }

    function netInfo() {
        const n = root.melatonNetworkDialogs;
        if (n && typeof n.connectionInfo === 'function') return n.connectionInfo();
        return { domain: 'DREAMSCAPE', fqdn: root.location ? root.location.hostname : '' };
    }

    function workspaceName() {
        /* global activeWorkspace, workspaces */
        const id = (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || '';
        const all = typeof workspaces !== 'undefined' ? workspaces : null;
        const ws = all && id ? all[id] : null;
        return (ws && (ws.name || ws.displayName)) || id || '';
    }

    function signedInAs() {
        const client = ws();
        let name = '';
        if (client && typeof client._getConnectionUsername === 'function') name = client._getConnectionUsername();
        let type = '';
        try { type = localStorage.getItem('userType') || ''; } catch (_) { /* blocked storage */ }
        const account = type === 'admin' ? 'Administrator' : type ? 'Guest' : '';
        if (!name || name === '—') return account;
        return account && account !== name ? `${name} (${account})` : name;
    }

    function browserText(nav) {
        if (!nav) return '';
        const data = nav.userAgentData;
        let browser = '';
        if (data && Array.isArray(data.brands)) {
            const brands = data.brands.filter((b) => b && b.brand && !/not.?a.?brand/i.test(b.brand));
            const pick = brands.find((b) => b.brand !== 'Chromium') || brands[0];
            if (pick) browser = `${pick.brand} ${pick.version}`;
        }
        const ua = nav.userAgent || '';
        if (!browser) {
            const m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
            const names = { Edg: 'Microsoft Edge', OPR: 'Opera', Firefox: 'Firefox', Chrome: 'Google Chrome', Version: 'Safari' };
            if (m) browser = `${names[m[1]]} ${m[2]}`;
        }
        let platform = data && data.platform ? data.platform : '';
        if (!platform) {
            platform = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android'
                : /iPhone|iPad/.test(ua) ? 'iOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
        }
        return [browser, platform && `on ${platform}`].filter(Boolean).join(' ');
    }

    /** navigator: logical processors and deviceMemory (a rounded figure the browser caps at 8 GB). */
    function deviceText(nav) {
        if (!nav) return '';
        const parts = [];
        if (nav.hardwareConcurrency) parts.push(`${nav.hardwareConcurrency} logical processor${nav.hardwareConcurrency === 1 ? '' : 's'}`);
        if (nav.deviceMemory) parts.push(nav.deviceMemory >= 8 ? '8 GB of memory or more' : `${nav.deviceMemory} GB of memory`);
        return parts.join(', ');
    }

    // ---- activation: the NovelAI account ----------------------------------------------------------

    /** FNV-1a, 32 bits. */
    function fnv(text, seed) {
        let h = (0x811c9dc5 ^ seed) >>> 0;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h;
    }

    const TIER_CHANNEL = ['PPR', 'TBL', 'SCR', 'OPS'];

    /**
     * The account as optionsData carries NovelAI's /user/data: 'checking' until it has loaded,
     * 'none' without an account (no NovelAI key, or the key does not sign in), else the account.
     */
    function novelAiAccount(od) {
        if (!od || od.accountDataDeferred === true || !('user' in od)) return { state: 'checking' };
        const user = od.user;
        const info = user && user.information;
        const created = info && Number(info.accountCreatedAt);
        if (!user || user.ok !== true || !(created > 0)) return { state: 'none' };
        const sub = user.subscription || {};
        return { state: 'activated', created, tier: Number(sub.tier) || 0, accountType: Number(sub.accountType) || 0 };
    }

    /**
     * Vista's Product ID shape (89578-OEM-7332157-00204) from the account: the groups are hashes of
     * when it was created, so they stay the same for the account and say nothing about it; the
     * channel is the subscription tier (Paper, Tablet, Scroll, Opus).
     */
    function productId(account) {
        if (!account || account.state !== 'activated') return '';
        const key = `novelai:${account.created}:${account.accountType}`;
        const pad = (n, w) => String(n % (10 ** w)).padStart(w, '0');
        const channel = TIER_CHANNEL[account.tier] || TIER_CHANNEL[0];
        return `${pad(fnv(key, 1), 5)}-${channel}-${pad(fnv(key, 2), 7)}-${pad(fnv(key, 3), 5)}`;
    }

    // ---- rating -------------------------------------------------------------------------------

    let rating = null;
    let ratingFailed = false;

    function experienceIndex() {
        return root.meletonExperienceIndex || null;
    }

    const SUBSCORE_LABELS = { processor: 'Processor', memory: 'Memory (RAM)', graphics: 'Graphics', gaming: 'Gaming graphics', disk: 'Primary hard disk' };

    function ratingTitle(r) {
        return Object.keys(SUBSCORE_LABELS)
            .map((k) => `${SUBSCORE_LABELS[k]}: ${typeof r.scores[k] === 'number' ? r.scores[k].toFixed(1) : 'Not rated'}`)
            .join('\n');
    }

    function ratingHtml() {
        if (rating && typeof rating.base === 'number') {
            return `<span class="cpl-sys-wei is-rated" title="${esc(ratingTitle(rating))}"><img src="${ART}/wei-rated.png" alt="" draggable="false"><span class="cpl-sys-wei-num">${rating.base.toFixed(1)}</span></span><span class="cpl-sys-wei-text">Melaton Experience Index</span>`;
        }
        const msg = ratingFailed || (rating && rating.base === null) ? 'System rating is not available' : 'Assessing this session...';
        return `<span class="cpl-sys-wei-text cpl-sys-wei-text--none">${msg}</span>`;
    }

    function linkState() {
        const c = cpl();
        return c && c._test && typeof c._test.linkState === 'function' ? c._test.linkState() : 'disconnected';
    }

    function edition(v, sys) {
        const info = v || {};
        const name = [info.fullName || info.productName || 'Melaton Desktop', info.edition].filter(Boolean).join(' ');
        const build = info.build && info.build !== 'Unknown' ? info.build : (sys && sys.gitHash && sys.gitHash !== 'Unknown' ? sys.gitHash : '');
        return {
            name,
            copyright: info.copyright || '',
            servicePack: info.servicePack || (build ? `Build ${build}` : '')
        };
    }

    // ---- data -------------------------------------------------------------------------------

    async function load() {
        loadFailed = false;
        try {
            if (typeof root.loadMeletonVersionInfo === 'function') {
                versionInfo = await root.loadMeletonVersionInfo();
                if (versionInfo && versionInfo.systemInfo) systemInfo = versionInfo.systemInfo;
            }
            const client = ws();
            if (!systemInfo && client && client.isConnected && client.isConnected()) {
                systemInfo = await client.sendMessage('get_system_info', {});
            }
        } catch (_err) {
            loadFailed = true;
        }
        if (!versionInfo && typeof root.getMeletonVersionInfo === 'function') versionInfo = root.getMeletonVersionInfo();
    }

    // ---- page -------------------------------------------------------------------------------

    function section(title, body, extraClass) {
        return `
            <section class="cpl-sys-section${extraClass ? ` ${extraClass}` : ''}">
                <h2 class="cpl-sys-head"><span>${esc(title)}</span></h2>
                ${body}
            </section>`;
    }

    function row(label, value, extra) {
        return `<div class="cpl-sys-row"><span class="cpl-sys-label">${esc(label)}</span><span class="cpl-sys-value">${value}</span>${extra || ''}</div>`;
    }

    function pageHtml() {
        const sys = systemInfo;
        const ed = edition(versionInfo, sys);
        const host = hostFacts(sys);
        const net = netInfo();
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        const client = ws();
        const state = linkState();
        const fqdn = String(net.fqdn || '');
        // an older server without host.*: the first label of the name the client reaches it by
        const computer = host.hostname || (fqdn && !/^[\d.]+$|:/.test(fqdn) ? fqdn.split('.')[0] : '');
        const account = novelAiAccount(root.optionsData);
        const pid = productId(account);
        const pending = !sys && !loadFailed;
        const value = (text) => (text ? esc(text) : `<span class="cpl-sys-na">${pending ? 'Checking...' : 'Not available'}</span>`);

        const editionBody = `
            <div class="cpl-sys-edition">
                <img class="cpl-sys-logo" src="${ART}/system-logo.png" alt="" draggable="false">
                <div class="cpl-sys-edition-text">
                    <p class="cpl-sys-line">${esc(ed.name)}</p>
                    ${ed.copyright ? `<p class="cpl-sys-line">${esc(ed.copyright)}</p>` : ''}
                    ${ed.servicePack ? `<p class="cpl-sys-line cpl-sys-line--last">${esc(ed.servicePack)}</p>` : ''}
                </div>
            </div>`;

        const systemBody = `
            <div class="cpl-sys-rows cpl-sys-rows--system">
                <div class="cpl-sys-row cpl-sys-row--rating">
                    <span class="cpl-sys-label">Rating:</span>
                    <span class="cpl-sys-value cpl-sys-rating">${ratingHtml()}</span>
                </div>
                ${row('Processor:', host.processor ? `${esc(host.processor)}${host.clock ? `<span class="cpl-sys-clock">${esc(host.clock)}</span>` : ''}` : value(''))}
                ${row('Memory (RAM):', value(host.memory))}
                ${row('System type:', value(host.type))}
            </div>`;

        const computerBody = `
            <div class="cpl-sys-rows cpl-sys-rows--computer">
                <button type="button" class="cpl-link cpl-sys-change" data-cpl-action="customize"><img src="${ART}/shield-uac-16.png" alt="">Change settings</button>
                ${row('Computer name:', value(computer))}
                ${row('Full computer name:', value(net.fqdn))}
                ${row('Computer description:', esc(workspaceName()))}
                ${row('Domain:', esc(net.domain))}
            </div>`;

        const sessionBody = `
            <div class="cpl-sys-rows cpl-sys-rows--computer">
                ${row('Signed in as:', value(signedInAs()))}
                ${row('Browser:', value(browserText(nav)))}
                ${row('Device:', value(deviceText(nav)))}
                ${row('Client version:', value(client && client.clientVersion ? client.clientVersion : ''))}
            </div>`;

        // the account decides; while it is unknown, say why (no domain link) or that it is coming
        let activation;
        if (account.state === 'activated') activation = '<p class="cpl-sys-line">Melaton is activated</p>';
        else if (account.state === 'none') activation = '<p class="cpl-sys-line">Melaton is not activated. <button type="button" class="cpl-link" data-cpl-action="nav" data-cpl-arg="authentication">Activate Melaton now</button></p>';
        else if (state === 'auth') activation = '<p class="cpl-sys-line">Melaton must log on to the domain. <button type="button" class="cpl-link" data-cpl-action="connect">Log on now</button></p>';
        else if (state !== 'connected') activation = '<p class="cpl-sys-line">Melaton is not connected to the domain controller. <button type="button" class="cpl-link" data-cpl-action="connect">Connect now</button></p>';
        else activation = '<p class="cpl-sys-line"><span class="cpl-sys-na">Checking activation...</span></p>';
        const activationBody = `
            <div class="cpl-sys-rows cpl-sys-rows--activation">
                ${activation}
                <p class="cpl-sys-line cpl-sys-pid"><span>Product ID:</span><span class="cpl-sys-pid-value">${pid ? esc(pid) : '<span class="cpl-sys-na">Not available</span>'}</span><button type="button" class="cpl-link" data-cpl-action="nav" data-cpl-arg="authentication">Change product key</button></p>
            </div>`;

        return `
            <button type="button" class="cpl-sys-help" data-cpl-sys="help" title="Get help with this page"><img src="/static_images/vista-explorer/help.png" alt="Help"></button>
            <h1 class="cpl-sys-title">View basic information about your computer</h1>
            ${section('Windows edition', editionBody, 'cpl-sys-section--edition')}
            ${section('System', systemBody)}
            ${section('Computer name, domain, and workgroup settings', computerBody)}
            ${section('Session', sessionBody)}
            ${section('Windows activation', activationBody)}`;
    }

    function paint() {
        if (!main) return;
        const page = main.querySelector('.cpl-sys-page');
        if (page) page.innerHTML = pageHtml();
    }

    async function assessRating() {
        const ei = experienceIndex();
        if (!ei) {
            ratingFailed = true;
            return;
        }
        rating = ei.cached();
        if (rating) return;
        try {
            rating = await ei.assess();
        } catch (_err) {
            ratingFailed = true;
        }
    }

    async function mount(el) {
        main = el;
        paint();
        // the rating runs beside the server call; whichever lands first paints first
        const rated = assessRating().then(() => paint());
        await load();
        paint();
        await rated;
        const modal = el.closest('.modal');
        if (modal && !modal.dataset.cplSysWired) {
            modal.dataset.cplSysWired = '1';
            modal.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-cpl-sys]');
                if (!b || !modal.contains(b)) return;
                // openGrimoireApplet: public/scripts/comp/modalUtils.js (Start menu Help and Support)
                if (b.dataset.cplSys === 'help' && typeof root.openGrimoireApplet === 'function') root.openGrimoireApplet();
            });
        }
    }

    function unmount() {
        main = null;
    }

    function shieldLink(label, action, arg) {
        return `<li><button type="button" class="cpl-link cpl-sys-task" data-cpl-action="${action}" data-cpl-arg="${esc(arg)}"><img src="${ART}/shield-uac-16.png" alt="">${esc(label)}</button></li>`;
    }

    function plainLink(label, action, arg) {
        return `<li><button type="button" class="cpl-link cpl-sys-task" data-cpl-action="${action}" data-cpl-arg="${esc(arg)}"><span class="cpl-sys-task-pad"></span>${esc(label)}</button></li>`;
    }

    function register() {
        if (registered) return true;
        const c = cpl();
        if (!c || typeof c.registerPage !== 'function') return false;
        registered = true;
        // the Classic View item is melatonControlPanel.js's own 'system' (it navigates here)
        c.registerPage('system', {
            title: () => 'System',
            tasks: () => `
                <div class="cpl-task-group cpl-sys-tasks">
                    <h3 class="cpl-task-heading">Tasks</h3>
                    <ul class="cpl-task-list">
                        ${shieldLink('Device Manager', 'item', 'dreamscape-services')}
                        ${shieldLink('Remote settings', 'item', 'remote-access')}
                        ${shieldLink('System protection', 'item', 'windows-defender')}
                        ${shieldLink('Advanced system settings', 'item', 'runes')}
                    </ul>
                </div>
                <div class="cpl-task-group cpl-task-group--see-also cpl-sys-tasks">
                    <h3 class="cpl-task-heading">See also</h3>
                    <ul class="cpl-task-list">
                        ${plainLink('Melaton Update', 'nav', 'update')}
                        ${plainLink('Dreamscape Services', 'nav', 'authentication')}
                        ${plainLink('Network and Server Center', 'nav', 'network')}
                    </ul>
                </div>`,
            body: () => '<div class="cpl-sys-page"></div>',
            mount,
            unmount
        });
        return true;
    }

    root.cplSystem = {
        register,
        open: () => register() && cpl().open('system'),
        _test: {
            formatMemory,
            formatClock,
            systemType,
            hostFacts,
            novelAiAccount,
            productId,
            browserText,
            deviceText,
            edition,
            render: (v, sys, r) => { versionInfo = v; systemInfo = sys; loadFailed = false; rating = r || null; ratingFailed = false; return pageHtml(); }
        }
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', register);
        else register();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = root.cplSystem;
})(typeof window !== 'undefined' ? window : globalThis);
