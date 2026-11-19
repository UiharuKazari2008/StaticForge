/**
 * Key Manager (Yozora #831): the MMC console that is the home of the application keys (they left
 * Dreamscape CardSpace, which links here) and a second place to manage the service keys (CardSpace
 * keeps its own cards for them). Modelled on Vista's Certificates snap-in (certmgr.msc: the tree,
 * the list columns, the Certificate dialog, Certificate Properties) and on Certificate Services'
 * Revoked / Issued / Pending / Failed request folders. Captures: ~/.cache/vista-vm/certmgr-ref/.
 *
 *   Keys - Dreamscape Server       the two stores (certmgr's "Certificates - Current User")
 *     Application Keys             keys programs use to reach Dreamscape
 *       Revoked Keys               revoked by the administrator, or superseded by a refreshed key
 *       Issued Keys                active, waiting for a refresh, or expired; New Key... (a wizard)
 *       Pending Requests           programs that asked for a key: Approve / Deny
 *       Failed Requests            denied requests
 *       Request Log                the requests programs made with their keys, 25 to a page
 *     Client Certificates          installed clients' sign-in certificates (Yozora #922, docs/client-certificates.md)
 *       Revoked Certificates       on the CRL; Issued Certificates: Revoke Certificate... (certsrv's reason box)
 *     Service Keys                 the keys Dreamscape uses for outside services, one folder each:
 *       <service>                  its keys: Use This Key, Edit Key..., Delete Key, Add Key...,
 *                                  Unlock Service (after repeated errors), health from apiKeyHealth
 *
 * A key's Properties (Open) is the Certificate dialog: General (purposes, issued to / by, validity,
 * the account it signs in as), Details (every field), Certification Path (server > account > key).
 * Edit Properties... is Certificate Properties: General (name, purposes) and Security (expiry,
 * persistent, keyless sign-in, trusted addresses). Server packets: 195-applicationAuthHandler.js
 * (list/create/update/revoke_application_key, *_application_auth_request(s), list_application_
 * request_log, get_application_auth_scopes) and the keychain's get_api_key_services, add / update /
 * delete_api_key, update_api_key_selections, unlock_api_service, push api_key_status_changed.
 * Admin only.
 *
 *   window.openKeyManager(node?)    node: 'root' | 'app' | 'issued' | 'pending' | 'failed' |
 *                                   'revoked' | 'log' | 'svc' | 'svc:<service id>'
 *   window.mmcAppKeys.def()         the def, for consoles that host this one (mmcConsole.compose)
 */
(function (root) {
    'use strict';

    const ID = 'keyManager';
    const TITLE = 'Key Manager';
    const ART = '/static_images/vista-certmgr';
    const ICON16 = `${ART}/keymgr-16.png`;
    const ICON32 = `${ART}/keymgr-32.png`;
    const FOLDER = '/static_images/vista-icons/explorer/folder-16.png';
    const SVC_KEY = '/static_images/vista-cpl/key-16.png';
    const ISSUER = 'Dreamscape';

    // dialog styles (DLGTEMPLATEEX, as the VM's)
    const SS = 0x50020000;
    const SS_NOPREFIX = 0x50020080;
    const EDIT = 0x50010080;
    const EDIT_RO = 0x50010880;
    const EDGE = 0x200;
    const CHECK = 0x50010003;
    const RADIO1 = 0x50030009; // WS_GROUP | WS_TABSTOP | BS_AUTORADIOBUTTON
    const RADIO = 0x50000009;
    const GROUP = 0x50000007;
    const COMBO = 0x50210003;
    const BTN = 0x50010000;
    const BTN_DIS = 0x58010000;
    const DEFBTN = 0x50010001;
    const LINK = 0x50010001;
    const LV = 0x5081800d;
    const TREE = 0x50810022;
    const RICH = 0x50000800;
    const RICH_BOX = 0x50214804;
    const RICH_STATUS = 0x50a14844;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const ws = () => root.wsClient || null;

    const S = {
        denied: false,
        loaded: false,
        error: '',
        keys: [],
        pending: [],
        failed: [],
        scopes: [],
        services: [],
        svcError: '',
        certs: [],
        certError: '',
        certHandler: null,
        log: { page: 1, items: [], meta: null, loading: false, loaded: false, error: '' },
        statusHandler: null,
        lastList: null
    };

    async function send(type, data) {
        const client = ws();
        if (!client || typeof client.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        const r = await client.sendMessage(type, data || {}, false);
        return (r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) && r.success === undefined) ? r.data : r;
    }

    function isAdmin() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    // ---- data -----------------------------------------------------------------------------------

    async function load(c) {
        if (!isAdmin()) { S.denied = true; if (c) c.refresh(); return; }
        S.denied = false;
        const [keys, pending, failed, scopes, services, certs] = await Promise.allSettled([
            send('list_application_keys', {}),
            send('list_application_auth_requests', { status: 'pending' }),
            send('list_application_auth_requests', { status: 'denied' }),
            send('get_application_auth_scopes', {}),
            send('get_api_key_services', {}),
            send('client_cert_list', {})
        ]);
        if (certs.status === 'fulfilled' && certs.value && Array.isArray(certs.value.certificates)) {
            S.certs = certs.value.certificates;
            S.certError = '';
        } else {
            S.certError = (certs.reason && certs.reason.message) || (certs.value && certs.value.error) || 'The client certificates could not be read.';
        }
        if (keys.status === 'fulfilled' && keys.value && Array.isArray(keys.value.keys)) {
            S.keys = keys.value.keys;
            S.error = '';
        } else {
            S.error = (keys.reason && keys.reason.message) || 'The application keys could not be read.';
        }
        S.pending = pending.status === 'fulfilled' && pending.value ? (pending.value.requests || []) : S.pending;
        S.failed = failed.status === 'fulfilled' && failed.value ? (failed.value.requests || []) : S.failed;
        S.scopes = scopes.status === 'fulfilled' && scopes.value ? (scopes.value.scopes || []) : S.scopes;
        if (services.status === 'fulfilled' && services.value && Array.isArray(services.value.services)) {
            S.services = services.value.services;
            S.svcError = '';
        } else if (services.status === 'rejected') {
            S.svcError = (services.reason && services.reason.message) || 'The service keys could not be read.';
        }
        S.loaded = true;
        if (c) c.refresh();
    }

    async function loadLog(c, page) {
        if (S.denied) return;
        S.log.loading = true;
        S.log.page = Math.max(1, page || S.log.page || 1);
        try {
            const data = await send('list_application_request_log', { page: S.log.page, perPage: 25 });
            if (!data || data.success === false) throw new Error('The request log could not be read.');
            S.log.items = data.requests || [];
            S.log.meta = data.pagination || { currentPage: S.log.page, totalPages: 1, totalCount: S.log.items.length };
            S.log.page = S.log.meta.currentPage || S.log.page;
            S.log.error = '';
        } catch (err) {
            S.log.error = (err && err.message) || 'The request log could not be read.';
        }
        S.log.loading = false;
        S.log.loaded = true;
        if (c) c.refresh();
    }

    const isRevoked = (k) => k.status === 'revoked' || k.status === 'replaced';
    const issued = () => S.keys.filter((k) => !isRevoked(k));
    const revoked = () => S.keys.filter(isRevoked);
    const keyById = (id) => S.keys.find((k) => String(k.id) === String(id)) || null;
    const service = (id) => S.services.find((s) => s.id === id) || null;

    // client certificates (Yozora #922, docs/client-certificates.md): installed clients' sign-in certificates
    const certIssued = () => S.certs.filter((k) => !k.revokedAt);
    const certRevoked = () => S.certs.filter((k) => !!k.revokedAt);
    const certBySerial = (key) => S.certs.find((k) => `cert:${k.serial}` === String(key)) || null;
    const CERT_KIND = { android: 'Android app', dreamos: 'DreamOS' };
    const CERT_STORE = { strongbox: 'StrongBox', tee: 'Hardware (TEE)', software: 'Software', file: 'Key file', tpm: 'TPM' };
    // certsrv's reason codes, the four this CA writes
    const CERT_REASONS = [['revoked', 'Unspecified'], ['key_compromise', 'Key Compromise'], ['superseded', 'Superseded'], ['cessation', 'Cease of Operation']];
    const certReason = (k) => (CERT_REASONS.find(([id]) => id === k.revokeReason) || ['', 'Unspecified'])[1];
    const certStatus = (k) => (k.revokedAt ? 'Revoked' : k.status === 'expired' ? 'Expired' : k.renew ? 'Renewal due' : 'Valid');

    function date(t) {
        if (!t) return '';
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }

    function longDate(t) {
        if (!t) return '';
        const d = new Date(t);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }

    const when = (t) => (root.mmcConsole ? root.mmcConsole.when(t) : date(t));
    const expires = (k) => (k.persistent || k.isPerpetual || !k.expiresAt ? 'Never' : date(k.expiresAt));
    const signsInAs = (k) => ((k.userType || 'admin') === 'admin' ? 'Administrator' : 'Read-only user');

    function scopeLabel(id) {
        if (id === 'universal') return 'All Dreamscape requests';
        const s = S.scopes.find((x) => x.id === id);
        return s ? (s.label || s.id) : id;
    }

    function purposes(list) {
        const scopes = Array.isArray(list) && list.length ? list : ['universal'];
        if (scopes.includes('universal')) return '<All>';
        return scopes.map(scopeLabel).join(', ');
    }

    function statusText(k) {
        switch (k.status) {
            case 'active': return 'Active';
            case 'refresh_required': return 'Refresh required';
            case 'expired': return 'Expired';
            case 'revoked': return 'Revoked';
            case 'replaced': return 'Superseded';
            default: return k.status || '';
        }
    }

    function shortUa(ua) {
        const s = String(ua || '');
        return s.length > 60 ? `${s.slice(0, 57)}...` : s;
    }

    const plural = (n, one, many) => (n === 0 ? `no ${many}` : n === 1 ? `1 ${one}` : `${n} ${many}`);

    // service keys: the key the service uses, its health words (modules/apiKeyHealth.js)
    const HEALTH = { ok: 'Working', fail: 'Not working', warn: 'Could not confirm', checking: 'Checking...', unchecked: 'Not checked yet', none: 'Not set' };
    const inUse = (s) => (s && Array.isArray(s.keys) && s.keys.length ? (Number.isInteger(s.selectedIndex) ? s.selectedIndex : s.keys[0].index) : null);
    const svcKey = (s, index) => (s && Array.isArray(s.keys) ? s.keys.find((k) => k.index === index) || null : null);
    const keyName = (k) => (k ? (k.name || `Key ${k.index + 1}`) : '');
    const health = (st) => HEALTH[(st && st.state) || 'unchecked'] || (st && st.state) || '';
    const locked = (s) => !!(s && s.lock && s.lock.locked);

    function svcHealth(s) {
        if (!s || s.statusCheck === false) return '';
        if (locked(s)) return `Locked (HTTP ${s.lock.lastStatus || '??'})`;
        const k = svcKey(s, inUse(s));
        return k ? health(k.status) : HEALTH.none;
    }

    // ---- the tree -------------------------------------------------------------------------------

    function nodes() {
        const svcs = S.services.map((s) => ({ id: `svc:${s.id}`, name: s.label || s.id, icon: FOLDER }));
        return [{
            id: 'root',
            name: 'Keys - Dreamscape Server',
            icon: ICON16,
            children: [
                {
                    id: 'app',
                    name: 'Application Keys',
                    icon: FOLDER,
                    children: [
                        { id: 'revoked', name: 'Revoked Keys', icon: FOLDER },
                        { id: 'issued', name: 'Issued Keys', icon: FOLDER },
                        { id: 'pending', name: 'Pending Requests', icon: FOLDER },
                        { id: 'failed', name: 'Failed Requests', icon: FOLDER },
                        { id: 'log', name: 'Request Log', icon: FOLDER }
                    ]
                },
                {
                    id: 'cc',
                    name: 'Client Certificates',
                    icon: FOLDER,
                    children: [
                        { id: 'cc-revoked', name: 'Revoked Certificates', icon: FOLDER },
                        { id: 'cc-issued', name: 'Issued Certificates', icon: FOLDER }
                    ]
                },
                { id: 'svc', name: 'Service Keys', icon: FOLDER, children: svcs }
            ]
        }];
    }

    // ---- list columns (certmgr's: Issued To 200, Issued By 200, Expiration Date 100, Intended
    // Purposes 125, Friendly Name 125, Status 50, Certificate Template 100) ---------------------

    const COLS = {
        issued: [
            { t: 'Issued To', w: 180, key: 'to', text: (k) => k.appName || '' },
            { t: 'Client', w: 170, key: 'ua', text: (k) => shortUa(k.userAgent) },
            { t: 'Expiration Date', w: 100, key: 'exp', text: expires, value: (k) => (k.persistent || k.isPerpetual || !k.expiresAt ? Infinity : k.expiresAt) },
            { t: 'Intended Purposes', w: 125, key: 'purp', text: (k) => purposes(k.scopes) },
            { t: 'Friendly Name', w: 110, key: 'fn', text: (k) => (k.keyPrefix ? `${k.keyPrefix}...` : '') },
            { t: 'Status', w: 100, key: 'st', text: statusText },
            { t: 'Signs In As', w: 100, key: 'as', text: signsInAs },
            { t: 'Last Used', w: 130, key: 'used', text: (k) => when(k.lastUsedAt), value: (k) => k.lastUsedAt || 0 }
        ],
        revoked: [
            { t: 'Issued To', w: 180, key: 'to', text: (k) => k.appName || '' },
            { t: 'Friendly Name', w: 110, key: 'fn', text: (k) => (k.keyPrefix ? `${k.keyPrefix}...` : '') },
            { t: 'Revocation Date', w: 130, key: 'rd', text: (k) => when(k.revokedAt), value: (k) => k.revokedAt || 0 },
            { t: 'Revocation Reason', w: 150, key: 'rr', text: (k) => (k.status === 'replaced' ? 'Superseded' : 'Revoked by the administrator') },
            { t: 'Client', w: 170, key: 'ua', text: (k) => shortUa(k.userAgent) },
            { t: 'Last Used', w: 130, key: 'used', text: (k) => when(k.lastUsedAt), value: (k) => k.lastUsedAt || 0 }
        ],
        pending: [
            { t: 'Request Code', w: 90, key: 'code', text: (r) => r.requestCode || '' },
            { t: 'Program', w: 160, key: 'app', text: (r) => r.appName || '' },
            { t: 'Client', w: 170, key: 'ua', text: (r) => shortUa(r.userAgent) },
            { t: 'Requested Purposes', w: 130, key: 'purp', text: (r) => purposes(r.scopes) },
            { t: 'Signs In As', w: 100, key: 'as', text: signsInAs },
            { t: 'Request Submission Date', w: 140, key: 'sub', text: (r) => when(r.createdAt), value: (r) => r.createdAt || 0 }
        ],
        failed: [
            { t: 'Request Code', w: 90, key: 'code', text: (r) => r.requestCode || '' },
            { t: 'Program', w: 160, key: 'app', text: (r) => r.appName || '' },
            { t: 'Client', w: 170, key: 'ua', text: (r) => shortUa(r.userAgent) },
            { t: 'Request Disposition', w: 120, key: 'disp', text: () => 'Denied by the administrator' },
            { t: 'Request Submission Date', w: 140, key: 'sub', text: (r) => when(r.createdAt), value: (r) => r.createdAt || 0 },
            { t: 'Denied Date', w: 130, key: 'den', text: (r) => when(r.approvedAt), value: (r) => r.approvedAt || 0 }
        ],
        log: [
            { t: 'Date and Time', w: 130, key: 'at', text: (r) => when(r.createdAt), value: (r) => r.createdAt || 0 },
            { t: 'Program', w: 150, key: 'app', text: (r) => r.appName || r.applicationKeyId || '' },
            { t: 'Method', w: 60, key: 'm', text: (r) => r.httpMethod || '' },
            { t: 'Path', w: 220, key: 'p', text: (r) => r.path || '' },
            { t: 'Status', w: 55, key: 'sc', num: true, text: (r) => String(r.statusCode || ''), value: (r) => Number(r.statusCode) || 0 },
            { t: 'Address', w: 120, key: 'ip', text: (r) => r.ip || '' },
            { t: 'Client', w: 170, key: 'ua', text: (r) => shortUa(r.userAgent) }
        ],
        ccIssued: [
            { t: 'Issued To', w: 170, key: 'to', text: (k) => k.deviceName || '' },
            { t: 'Issued By', w: 140, key: 'by', text: () => 'Dreamscape Client CA' },
            { t: 'Expiration Date', w: 100, key: 'exp', text: (k) => date(k.notAfter), value: (k) => k.notAfter || 0 },
            { t: 'Client', w: 90, key: 'kind', text: (k) => CERT_KIND[k.kind] || k.kind || '' },
            { t: 'Status', w: 90, key: 'st', text: certStatus },
            { t: 'Signs In As', w: 100, key: 'as', text: signsInAs },
            { t: 'Key Storage', w: 100, key: 'ks', text: (k) => CERT_STORE[k.keyStore] || k.keyStore || '' },
            { t: 'Last Used', w: 130, key: 'used', text: (k) => when(k.lastUsedAt), value: (k) => k.lastUsedAt || 0 },
            { t: 'Serial Number', w: 230, key: 'sn', text: (k) => k.serial || '' }
        ],
        ccRevoked: [
            { t: 'Issued To', w: 170, key: 'to', text: (k) => k.deviceName || '' },
            { t: 'Revocation Date', w: 130, key: 'rd', text: (k) => when(k.revokedAt), value: (k) => k.revokedAt || 0 },
            { t: 'Revocation Reason', w: 130, key: 'rr', text: certReason },
            { t: 'Client', w: 90, key: 'kind', text: (k) => CERT_KIND[k.kind] || k.kind || '' },
            { t: 'Expiration Date', w: 100, key: 'exp', text: (k) => date(k.notAfter), value: (k) => k.notAfter || 0 },
            { t: 'Serial Number', w: 230, key: 'sn', text: (k) => k.serial || '' }
        ],
        svc: [
            { t: 'Service', w: 160, key: 'n', text: (s) => s.label || s.id },
            { t: 'Key in Use', w: 150, key: 'k', text: (s) => (s.missingKeys ? '' : keyName(svcKey(s, inUse(s)))) },
            { t: 'Fingerprint', w: 120, key: 'fp', text: (s) => { const k = svcKey(s, inUse(s)); return k ? (k.fingerprint || '') : ''; } },
            { t: 'Status', w: 130, key: 'st', text: svcHealth },
            { t: 'Keys', w: 50, key: 'c', num: true, text: (s) => String((s.keys || []).length), value: (s) => (s.keys || []).length },
            { t: 'Description', w: 260, key: 'd', text: (s) => s.description || '' }
        ]
    };

    function svcCols(s) {
        const cols = [
            { t: 'Name', w: 170, key: 'n', text: (k) => keyName(k) },
            { t: 'Fingerprint', w: 120, key: 'fp', text: (k) => k.fingerprint || '' },
            { t: 'Status', w: 120, key: 'st', text: (k) => (s.statusCheck === false ? '' : health(k.status)) },
            { t: 'In Use', w: 60, key: 'u', text: (k) => (k.index === inUse(s) ? 'Yes' : '') }
        ];
        if (s.secondary) {
            cols.push({ t: s.secondary.label, w: 120, key: 'sfp', text: (k) => k.secondaryFingerprint || '' });
            cols.push({ t: `${s.secondary.label} Status`, w: 130, key: 'sst', text: (k) => (k.secondaryStatus && k.secondaryStatus.state !== 'none' ? health(k.secondaryStatus) : '') });
        }
        return cols;
    }

    // ---- pages ----------------------------------------------------------------------------------

    function deniedPage(c) {
        return c.page(TITLE, '', [{ id: 'akm-denied', title: 'Access is denied', body: `<p>${c.state(false, 'Key Manager needs the Administrator. Sign in as the Administrator to use it.')}</p>` }]);
    }

    function list(c, id, cols, data, rowKey, icon, empty, extra) {
        S.lastList = { name: extra && extra.name, cols, data };
        const rows = data.map((d) => ({ key: rowKey(d), data: d, icon: typeof icon === 'function' ? icon(d) : icon, open: extra && extra.open ? extra.open(d) : undefined }));
        return { html: c.listView(cols, rows, { sortId: `akm-${id}`, sort: extra && extra.sort, empty }), list: true };
    }

    function folders(c, id, items) {
        const cols = [{ t: id === 'root' ? 'Logical Store Name' : 'Name', w: 300, key: 'n', text: (d) => d.name }];
        const rows = items.map((n) => ({ key: null, data: n, icon: FOLDER, open: n.id }));
        S.lastList = { name: id, cols, data: items };
        return { html: c.listView(cols, rows, {}), list: true };
    }

    function page(node, c) {
        if (S.denied) return deniedPage(c);
        if (!S.loaded) return c.page(TITLE, 'Reading data, please wait...', [{ id: 'akm-load', title: TITLE, body: '<p>Reading data, please wait...</p>' }]);
        const id = node.id;
        if (id === 'root' || id === 'app' || id === 'cc') return folders(c, id, (node.children || []));
        if (id === 'cc-issued' || id === 'cc-revoked') {
            const title = id === 'cc-issued' ? 'Issued Certificates' : 'Revoked Certificates';
            if (S.certError) return c.page(title, '', [{ id: 'akm-err', title, body: `<p>${c.state(false, S.certError)}</p>` }]);
            if (id === 'cc-issued') return list(c, id, COLS.ccIssued, certIssued(), (k) => `cert:${k.serial}`, `${ART}/cert-16.png`, 'There are no items to show in this view.', { name: title, sort: { key: 'to', dir: 1 } });
            return list(c, id, COLS.ccRevoked, certRevoked(), (k) => `cert:${k.serial}`, `${ART}/revoked-16.png`, 'There are no items to show in this view.', { name: title, sort: { key: 'rd', dir: -1 } });
        }
        if (id === 'issued') {
            if (S.error) return c.page('Issued Keys', '', [{ id: 'akm-err', title: 'Issued Keys', body: `<p>${c.state(false, S.error)}</p>` }]);
            return list(c, id, COLS.issued, issued(), (k) => k.id, (k) => (k.status === 'active' ? `${ART}/key-16.png` : `${ART}/cert-16.png`), 'There are no items to show in this view.', { name: 'Issued Keys', sort: { key: 'to', dir: 1 } });
        }
        if (id === 'revoked') return list(c, id, COLS.revoked, revoked(), (k) => k.id, `${ART}/revoked-16.png`, 'There are no items to show in this view.', { name: 'Revoked Keys', sort: { key: 'rd', dir: -1 } });
        if (id === 'pending') return list(c, id, COLS.pending, S.pending, (r) => `req:${r.id}`, `${ART}/request-16.png`, 'There are no items to show in this view.', { name: 'Pending Requests', sort: { key: 'sub', dir: -1 } });
        if (id === 'failed') return list(c, id, COLS.failed, S.failed, (r) => `req:${r.id}`, `${ART}/request-16.png`, 'There are no items to show in this view.', { name: 'Failed Requests', sort: { key: 'sub', dir: -1 } });
        if (id === 'log') {
            if (!S.log.loaded && !S.log.loading) void loadLog(c, 1);
            if (S.log.error) return c.page('Request Log', '', [{ id: 'akm-err', title: 'Request Log', body: `<p>${c.state(false, S.log.error)}</p>` }]);
            if (!S.log.loaded) return c.page('Request Log', 'Reading data, please wait...', [{ id: 'akm-load', title: 'Request Log', body: '<p>Reading data, please wait...</p>' }]);
            return list(c, id, COLS.log, S.log.items, (r) => `log:${r.id}`, `${ART}/list-16.png`, 'No program has made a request with an application key.', { name: 'Request Log' });
        }
        if (id === 'svc') {
            if (S.svcError && !S.services.length) return c.page('Service Keys', '', [{ id: 'akm-err', title: 'Service Keys', body: `<p>${c.state(false, S.svcError)}</p>` }]);
            return list(c, id, COLS.svc, S.services, (s) => `svc:${s.id}`, FOLDER, 'No service providers are configured.', { name: 'Service Keys', open: (s) => `svc:${s.id}` });
        }
        if (id.startsWith('svc:')) {
            const s = service(id.slice(4));
            if (!s) return '';
            return list(c, id, svcCols(s), s.keys || [], (k) => `key:${k.index}`, SVC_KEY, `There are no keys for ${s.label || s.id}. To add one, click Add Key... in the Action pane.`, { name: s.label || s.id });
        }
        return '';
    }

    function status(node) {
        if (S.denied) return 'Access is denied';
        if (!S.loaded) return 'Reading data, please wait...';
        switch (node.id) {
            case 'issued': return `Issued Keys contains ${plural(issued().length, 'key', 'keys')}.`;
            case 'revoked': return `Revoked Keys contains ${plural(revoked().length, 'key', 'keys')}.`;
            case 'cc-issued': return `Issued Certificates contains ${plural(certIssued().length, 'certificate', 'certificates')}.`;
            case 'cc-revoked': return `Revoked Certificates contains ${plural(certRevoked().length, 'certificate', 'certificates')}.`;
            case 'pending': return `Pending Requests contains ${plural(S.pending.length, 'request', 'requests')}.`;
            case 'failed': return `Failed Requests contains ${plural(S.failed.length, 'request', 'requests')}.`;
            case 'log': {
                const m = S.log.meta;
                return m ? `Page ${m.currentPage || S.log.page} of ${m.totalPages || 1} (${plural(m.totalCount || 0, 'request', 'requests')})` : '';
            }
            case 'svc': return `${plural(S.services.length, 'service', 'services')}`;
            default:
                if (node.id.startsWith('svc:')) {
                    const s = service(node.id.slice(4));
                    if (!s) return '';
                    if (locked(s)) return `${s.label || s.id} is locked after repeated errors (last HTTP ${s.lock.lastStatus || '??'}).`;
                    return `${s.label || s.id} has ${plural((s.keys || []).length, 'key', 'keys')}.`;
                }
                return '';
        }
    }

    // ---- commands -------------------------------------------------------------------------------

    const isList = (id) => ['issued', 'revoked', 'pending', 'failed', 'log', 'svc', 'cc-issued', 'cc-revoked'].includes(id) || String(id).startsWith('svc:');

    function commands(node) {
        if (S.denied) return [];
        const out = [];
        const id = node.id;
        if (id === 'app' || id === 'issued') out.push({ text: 'New Key...', action: 'new-key', icon: `${ART}/key-16.png` });
        if (id === 'log') {
            const m = S.log.meta || {};
            out.push({ text: 'Newer Requests', action: 'log-prev', disabled: (m.currentPage || S.log.page) <= 1 });
            out.push({ text: 'Older Requests', action: 'log-next', disabled: (m.currentPage || S.log.page) >= (m.totalPages || 1) });
        }
        if (id.startsWith('svc:')) {
            const s = service(id.slice(4));
            out.push({ text: 'Add Key...', action: 'svc-add', icon: SVC_KEY, disabled: !s });
            if (locked(s)) out.push({ text: 'Unlock Service', action: 'svc-unlock' });
        }
        if (isList(id)) {
            if (out.length) out.push({ separator: true });
            out.push({ text: 'Export List...', action: 'export', icon: 16 });
        }
        return out;
    }

    function selCommands(node, key) {
        if (S.denied || key == null) return null;
        const id = node.id;
        if (id === 'issued' || id === 'revoked') {
            const k = keyById(key);
            if (!k) return null;
            const items = [{ text: 'Open', action: 'open' }];
            if (!isRevoked(k)) {
                items.push({ text: 'Edit Properties...', action: 'edit-key' });
                const canRevoke = k.status === 'active' || k.status === 'refresh_required';
                items.push({ separator: true }, { text: 'Revoke Key...', action: 'revoke', disabled: !canRevoke });
            }
            return { title: k.appName || 'Key', items };
        }
        if (id === 'cc-issued' || id === 'cc-revoked') {
            const k = certBySerial(key);
            if (!k) return null;
            const items = [{ text: 'Open', action: 'open' }];
            if (!k.revokedAt) items.push({ separator: true }, { text: 'Revoke Certificate...', action: 'cc-revoke' });
            return { title: k.deviceName || 'Certificate', items };
        }
        if (id === 'pending' || id === 'failed') {
            const r = request(key);
            if (!r) return null;
            const items = [{ text: 'Open', action: 'open' }];
            if (id === 'pending') items.unshift({ text: 'Approve', action: 'approve' }, { text: 'Deny', action: 'deny' }, { separator: true });
            return { title: r.appName || 'Request', items };
        }
        if (id === 'log') {
            const r = S.log.items.find((x) => `log:${x.id}` === String(key));
            const k = r && keyById(r.applicationKeyId);
            return r ? { title: r.appName || 'Request', items: [{ text: 'Open Key', action: 'open', disabled: !k }] } : null;
        }
        if (id === 'svc') {
            const s = service(String(key).slice(4));
            return s ? { title: s.label || s.id, items: [{ text: 'Open', action: 'open' }] } : null;
        }
        if (id.startsWith('svc:')) {
            const s = service(id.slice(4));
            const k = s && svcKey(s, Number(String(key).slice(4)));
            if (!k) return null;
            return {
                title: keyName(k),
                items: [
                    { text: 'Use This Key', action: 'svc-use', disabled: k.index === inUse(s) },
                    { text: 'Edit Key...', action: 'svc-edit' },
                    { separator: true },
                    { text: 'Delete Key', action: 'svc-delete' }
                ]
            };
        }
        return null;
    }

    function request(key) {
        const id = String(key || '').replace(/^req:/, '');
        return S.pending.find((r) => String(r.id) === id) || S.failed.find((r) => String(r.id) === id) || null;
    }

    async function action(a, c, arg) {
        const node = c.node;
        switch (a) {
            case 'refresh':
                S.log.loaded = false;
                await load(c);
                return true;
            case 'new-key': newKeyWizard(c); return true;
            case 'open': openSelected(c); return true;
            case 'edit-key': { const k = keyById(c.sel); if (k) editKey(c, k); return true; }
            case 'revoke': await revokeKey(c, keyById(c.sel)); return true;
            case 'cc-revoke': revokeCert(c, certBySerial(c.sel)); return true;
            case 'approve': await approve(c, request(c.sel)); return true;
            case 'deny': await deny(c, request(c.sel)); return true;
            case 'delete':
                if (node === 'issued') await revokeKey(c, keyById(c.sel));
                else if (node === 'cc-issued') revokeCert(c, certBySerial(c.sel));
                else if (node === 'pending') await deny(c, request(c.sel));
                else if (String(node).startsWith('svc:')) await svcDelete(c);
                return true;
            case 'log-prev': await loadLog(c, (S.log.meta && S.log.meta.currentPage ? S.log.meta.currentPage : S.log.page) - 1); return true;
            case 'log-next': await loadLog(c, (S.log.meta && S.log.meta.currentPage ? S.log.meta.currentPage : S.log.page) + 1); return true;
            case 'export': exportList(c); return true;
            case 'svc-add': svcKeyDialog(c, service(String(node).slice(4)), null); return true;
            case 'svc-edit': { const s = service(String(node).slice(4)); svcKeyDialog(c, s, s && svcKey(s, Number(String(c.sel).slice(4)))); return true; }
            case 'svc-delete': await svcDelete(c); return true;
            case 'svc-use': await svcUse(c); return true;
            case 'svc-unlock': await svcUnlock(c); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('key-manager'); return true;
            default: return false;
        }
    }

    function openSelected(c) {
        const node = c.node;
        if (node === 'issued' || node === 'revoked') { const k = keyById(c.sel); if (k) keySheet(c, k); return; }
        if (node === 'cc-issued' || node === 'cc-revoked') { const k = certBySerial(c.sel); if (k) certBox(c, k); return; }
        if (node === 'pending' || node === 'failed') { const r = request(c.sel); if (r) requestBox(c, r, node); return; }
        if (node === 'log') {
            const r = S.log.items.find((x) => `log:${x.id}` === String(c.sel));
            const k = r && keyById(r.applicationKeyId);
            if (k) keySheet(c, k);
            return;
        }
        if (node === 'svc' && c.sel) c.select(String(c.sel), true);
    }

    function rowOpen(key, node, c) {
        if (node.id.startsWith('svc:')) { svcKeyDialog(c, service(node.id.slice(4)), svcKey(service(node.id.slice(4)), Number(String(key).slice(4)))); return; }
        openSelected(c);
    }

    function exportList(c) {
        const L = S.lastList;
        if (!L) return;
        const lines = [L.cols.map((col) => col.t).join('\t')].concat(L.data.map((d) => L.cols.map((col) => String(col.text(d)).replace(/[\t\r\n]+/g, ' ')).join('\t')));
        const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(L.name || 'Keys').replace(/[^\w -]+/g, '')}.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        c.note('The list was exported.');
    }

    // ---- application key operations ---------------------------------------------------------------

    async function revokeKey(c, k) {
        if (!k || !(k.status === 'active' || k.status === 'refresh_required')) return;
        const ok = await c.box(`<p>Are you sure you want to revoke the key for <b>${esc(k.appName)}</b>?</p><p>Programs that use this key lose access to Dreamscape at once. A revoked key cannot be used again.</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Revoke Key' });
        if (ok !== true) return;
        try {
            const r = await send('revoke_application_key', { keyId: k.id });
            if (r && r.success === false) throw new Error(r.error || 'The key could not be revoked.');
            c.note(`The key for ${k.appName} was revoked.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The key could not be revoked.')}</p>`, null, { icon: 'error' });
        }
        c.sel = null;
        await load(c);
    }

    function certBox(c, k) {
        const rows = [
            ['Issued to', k.deviceName], ['Issued by', 'Dreamscape Client CA'], ['Client', CERT_KIND[k.kind] || k.kind],
            ['Device ID', k.deviceId], ['Signs in as', signsInAs(k)], ['Key storage', CERT_STORE[k.keyStore] || k.keyStore],
            ['Valid from', longDate(k.notBefore)], ['Valid to', longDate(k.notAfter)], ['Status', certStatus(k)],
            ['Serial number', k.serial], ['Thumbprint (SHA-256)', k.fingerprint],
            ['Issued', `${when(k.issuedAt)}${k.issuedIp ? ` from ${k.issuedIp}` : ''}`],
            ['Last used', k.lastUsedAt ? `${when(k.lastUsedAt)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}` : 'Never'],
            k.replacesSerial ? ['Renewal of', k.replacesSerial] : null,
            k.revokedAt ? ['Revoked', `${when(k.revokedAt)} (${certReason(k)})`] : null
        ].filter(Boolean);
        void c.box(`<table class="akm-req-props">${rows.map(([n, v]) => `<tr><td>${esc(n)}:</td><td>${esc(v || '')}</td></tr>`).join('')}</table>`, null, { icon: 'info', title: 'Certificate', width: 520 });
    }

    /** certsrv's Certificate Revocation box: the question, a reason code, Yes / No. */
    function revokeCert(c, k) {
        if (!k || k.revokedAt) return;
        const tpl = { t: '', w: 252, h: 96, f: ['MS Shell Dlg', 8], s: 0, c: [
            [851, 'S', 7, 7, 238, 34, SS_NOPREFIX, '', 0],
            [-1, 'S', 7, 47, 60, 8, SS, '&Reason code:', 0],
            [852, 'C', 70, 45, 110, 80, COMBO, '', 0],
            [853, 'S', 7, 62, 130, 24, SS, '', 0],
            [1, 'B', 141, 75, 50, 14, DEFBTN, '&Yes', 0],
            [2, 'B', 195, 75, 50, 14, BTN, '&No', 0]
        ] };
        api().openDialog({
            id: 'akmCertRevoke',
            tpl,
            title: 'Certificate Revocation',
            owner: c.modal,
            bareCaption: true,
            init: (ctx) => {
                ctx.text(851, `Are you sure you want to revoke the certificate of ${k.deviceName}? The client is signed out at once and must sign in again to get a new certificate.`);
                ctx.options(852, CERT_REASONS.map(([value, text]) => ({ value, text })), 'revoked');
            },
            ok: async (ctx) => {
                try {
                    const r = await send('client_cert_revoke', { serial: k.serial, reason: ctx.get(852) || 'revoked' });
                    if (!r || r.success === false) throw new Error((r && r.error) || 'The certificate could not be revoked.');
                    c.note(`The certificate of ${k.deviceName} was revoked.`);
                } catch (err) {
                    ctx.html(853, `<span class="akm-wiz-error"><img src="/static_images/vista-icons/error-16.png" alt="">${esc((err && err.message) || 'The certificate could not be revoked.')}</span>`);
                    return false;
                }
                c.sel = null;
                void load(c);
                return true;
            }
        });
    }

    async function approve(c, r) {
        if (!r) return;
        const ok = await c.box(`<p>Issue a key to <b>${esc(r.appName)}</b>?</p><p>Request code: <b>${esc(r.requestCode)}</b><br>Client: ${esc(r.userAgent)}<br>Purposes: ${esc(purposes(r.scopes))}<br>Signs in as: ${esc(signsInAs(r))}</p><p>Approve only a request whose code the program showed you.</p>`,
            [{ text: 'Approve', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Approve Request' });
        if (ok !== true) return;
        try {
            const res = await send('approve_application_auth_request', { requestId: r.id });
            if (!res || res.success === false) throw new Error((res && res.error) || 'The request could not be approved.');
            c.sel = null;
            await load(c);
            if (res.applicationKey) issuedDialog(c, r.appName, res.applicationKey, true);
            else c.note(`The request from ${r.appName} was approved. The program collects its key itself.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The request could not be approved.')}</p>`, null, { icon: 'error' });
        }
    }

    async function deny(c, r) {
        if (!r || r.status === 'denied') return;
        const ok = await c.box(`<p>Do you want to deny the request from <b>${esc(r.appName)}</b> (code ${esc(r.requestCode)})?</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Deny Request' });
        if (ok !== true) return;
        try {
            const res = await send('deny_application_auth_request', { requestId: r.id });
            if (res && res.success === false) throw new Error(res.error || 'The request could not be denied.');
            c.note(`The request from ${r.appName} was denied.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The request could not be denied.')}</p>`, null, { icon: 'error' });
        }
        c.sel = null;
        await load(c);
    }

    function requestBox(c, r, node) {
        const rows = [
            ['Request code', r.requestCode], ['Program', r.appName], ['Client', r.userAgent],
            ['Requested purposes', purposes(r.scopes)], ['Signs in as', signsInAs(r)],
            ['Key expires', r.expiresAt ? date(r.expiresAt) : 'Never'], ['Refresh every', r.refreshIntervalDays ? `${r.refreshIntervalDays} days` : ''],
            ['Submitted', when(r.createdAt)], node === 'failed' ? ['Denied', when(r.approvedAt)] : null
        ].filter(Boolean);
        void c.box(`<table class="akm-req-props">${rows.map(([k, v]) => `<tr><td>${esc(k)}:</td><td>${esc(v || '')}</td></tr>`).join('')}</table>`, null, { icon: 'info', title: node === 'failed' ? 'Failed Request' : 'Pending Request', width: 440 });
    }

    // ---- dialogs: templates (DLU, MS Shell Dlg 8) ----------------------------------------------

    function templates() {
        const F = ['MS Shell Dlg', 8];
        const T = {
            // the Certificate dialog's pages (cryptui.dll.mui 130 / 131 / 132)
            'akm:general': { t: 'General', w: 255, h: 255, f: F, s: 0, c: [
                [900, 'S', 9, 6, 238, 201, SS, '', 0],
                [110, 'RICHEDIT50W', 41, 21, 170, 11, RICH, '', 0],
                [111, 'RICHEDIT50W', 16, 40, 216, 11, RICH, '', 0],
                [103, 'RICHEDIT50W', 33, 51, 206, 50, RICH, '', 0],
                [116, 'RICHEDIT50W', 16, 42, 206, 60, RICH, '', 0],
                [117, 'RICHEDIT50W', 16, 103, 200, 11, RICH, '', 0],
                [113, 'RICHEDIT50W', 33, 123, 44, 11, RICH, '', 0],
                [105, 'RICHEDIT50W', 78, 123, 162, 22, RICH, '', 0],
                [114, 'RICHEDIT50W', 33, 149, 44, 11, RICH, '', 0],
                [106, 'RICHEDIT50W', 78, 149, 162, 22, RICH, '', 0],
                [115, 'RICHEDIT50W', 34, 175, 206, 11, RICH, '', 0],
                [118, 'RICHEDIT50W', 33, 190, 200, 11, RICH, '', 0],
                [102, 'B', 179, 216, 68, 14, BTN_DIS, 'Issuer &Statement', 0],
                [119, 'SysLink', 6, 234, 242, 12, LINK, 'Learn more about <a>application keys</a>', 0]
            ] },
            'akm:details': { t: 'Details', w: 255, h: 255, f: F, s: 0, c: [
                [-1, 'S', 5, 10, 24, 8, SS, '&Show:', 0],
                [100, 'C', 31, 8, 130, 68, COMBO, '', 0],
                [101, 'SysListView32', 6, 29, 242, 97, LV, '', 0],
                [102, 'E', 6, 135, 242, 75, 0x50a10844, '', EDGE],
                [105, 'B', 107, 216, 68, 14, BTN, '&Edit Properties...', 0],
                [103, 'B', 180, 216, 68, 14, BTN, '&Copy to File...', 0],
                [106, 'SysLink', 6, 234, 242, 12, LINK, 'Learn more about <a>key details</a>', 0]
            ] },
            'akm:path': { t: 'Certification Path', w: 255, h: 255, f: F, s: 0, c: [
                [-1, 'B', 7, 7, 242, 170, GROUP, 'Certification &path', 0],
                [101, 'SysTreeView32', 13, 18, 229, 132, TREE, '', 0],
                [100, 'B', 167, 156, 75, 15, BTN_DIS, '&View Certificate', 0],
                [-1, 'S', 7, 184, 61, 8, SS, 'Certificate &status:', 0],
                [102, 'E', 7, 195, 242, 34, 0x50a10844, '', EDGE],
                [106, 'SysLink', 6, 234, 242, 12, LINK, 'Learn more about <a>certification paths</a>', 0]
            ] },
            // Certificate Properties' General page (cryptui.dll.mui 137)
            'akm:props': { t: 'General', w: 255, h: 255, f: F, s: 0, c: [
                [-1, 'S', 7, 10, 57, 9, SS, '&Friendly name:', 0],
                [102, 'E', 68, 9, 180, 13, EDIT, '', EDGE],
                [-1, 'S', 7, 25, 57, 9, SS, '&Client:', 0],
                [101, 'E', 68, 25, 180, 13, EDIT_RO, '', EDGE],
                [-1, 'B', 7, 45, 242, 180, GROUP, 'Key p&urposes', 0],
                [104, 'B', 13, 57, 230, 10, RADIO1, '&Enable all purposes for this key', 0],
                [105, 'B', 13, 70, 230, 10, RADIO | 0x08000000, 'D&isable all purposes for this key', 0],
                [106, 'B', 13, 83, 230, 10, RADIO, 'Enable &only the following purposes', 0],
                [-1, 'S', 30, 97, 209, 16, SS, 'Note: Each purpose lets the program use one group of Dreamscape requests.', 0],
                [100, 'S', 30, 118, 211, 84, SS, '', 0],
                [103, 'B', 185, 206, 56, 15, BTN_DIS, 'Add &Purpose...', 0],
                [107, 'SysLink', 6, 230, 242, 12, LINK, 'Learn more about <a>key properties</a>', 0]
            ] },
            'akm:security': { t: 'Security', w: 255, h: 255, f: F, s: 0, c: [
                [-1, 'B', 7, 7, 242, 58, GROUP, 'Expiration', 0],
                [-1, 'S', 15, 21, 60, 8, SS, 'Key &expires:', 0],
                [201, 'C', 80, 19, 110, 80, COMBO, '', 0],
                [202, 'S', 15, 40, 226, 18, SS_NOPREFIX, '', 0],
                [-1, 'B', 7, 72, 242, 150, GROUP, 'Sign-in', 0],
                [203, 'B', 15, 86, 226, 18, CHECK | 0x2000, 'Signs in as the &Administrator (the program can change and delete data)', 0],
                [204, 'B', 15, 108, 226, 18, CHECK | 0x2000, '&Persistent: the program never has to refresh this key', 0],
                [205, 'B', 15, 130, 226, 18, CHECK | 0x2000, 'Allow &keyless sign-in from the trusted addresses', 0],
                [-1, 'S', 15, 154, 226, 8, SS, '&Trusted addresses (CIDR, separated by commas):', 0],
                [206, 'E', 15, 165, 226, 14, EDIT, '', EDGE],
                [-1, 'S', 15, 184, 226, 32, SS, 'Leave the box empty to accept the key from any address. Keyless sign-in needs at least one trusted address.', 0]
            ] },
            // the New Key wizard (Aero Wizard pages)
            'akm:new1': { t: '', w: 300, h: 180, f: F, s: 0, c: [
                [-1, 'S', 0, 0, 290, 26, SS, 'Name the program this key is for, and the client name (User-Agent) it sends. The key works only for that client.', 0],
                [-1, 'S', 0, 36, 290, 8, SS, 'Program &name:', 0],
                [301, 'E', 0, 47, 220, 14, EDIT, '', EDGE],
                [-1, 'S', 0, 70, 290, 8, SS, '&Client (User-Agent):', 0],
                [302, 'E', 0, 81, 290, 14, EDIT, '', EDGE],
                [303, 'S', 0, 104, 290, 24, SS, '', 0]
            ] },
            'akm:new2': { t: '', w: 300, h: 180, f: F, s: 0, c: [
                [401, 'B', 0, 0, 290, 10, RADIO1, '&Enable all purposes for this key', 0],
                [402, 'B', 0, 14, 290, 10, RADIO, 'Enable &only the following purposes', 0],
                [403, 'S', 14, 28, 276, 92, SS, '', 0],
                [-1, 'S', 0, 128, 70, 8, SS, 'Signs in as:', 0],
                [404, 'B', 72, 128, 100, 10, RADIO1, '&Administrator', 0],
                [405, 'B', 176, 128, 110, 10, RADIO, '&Read-only user', 0],
                [406, 'S', 0, 146, 290, 24, SS, '', 0]
            ] },
            'akm:new3': { t: '', w: 300, h: 180, f: F, s: 0, c: [
                [-1, 'S', 0, 2, 70, 8, SS, 'Key &expires:', 0],
                [501, 'C', 72, 0, 110, 80, COMBO, '', 0],
                [-1, 'S', 0, 22, 110, 8, SS, 'The program refreshes it every', 0],
                [502, 'E', 112, 20, 30, 14, EDIT | 0x2000, '30', EDGE],
                [-1, 'S', 146, 22, 40, 8, SS, 'days.', 0],
                [503, 'B', 0, 42, 290, 10, CHECK, '&Persistent: the program never has to refresh this key', 0],
                [504, 'B', 0, 56, 290, 10, CHECK, 'Allow &keyless sign-in from the trusted addresses', 0],
                [-1, 'S', 0, 74, 290, 8, SS, '&Trusted addresses (CIDR, separated by commas):', 0],
                [505, 'E', 0, 85, 290, 14, EDIT, '', EDGE],
                [-1, 'S', 0, 104, 290, 24, SS, 'Leave the box empty to accept the key from any address. Keyless sign-in needs at least one trusted address.', 0],
                [506, 'S', 0, 134, 290, 24, SS, '', 0]
            ] },
            'akm:done': { t: '', w: 300, h: 180, f: F, s: 0, c: [
                [601, 'S', 0, 0, 290, 18, SS, '', 0],
                [-1, 'S', 0, 26, 290, 8, SS, 'Application &key:', 0],
                [602, 'E', 0, 37, 290, 14, EDIT_RO, '', EDGE],
                [603, 'B', 230, 56, 60, 14, BTN, '&Copy', 0],
                [604, 'S', 0, 80, 290, 34, SS, 'Copy this key now and give it to the program. Dreamscape keeps only a fingerprint of it, so it cannot be shown again.', 0]
            ] },
            // a key issued for an approved request
            'akm:issued': { t: 'Key Issued', w: 260, h: 110, f: F, s: 0, c: [
                [-1, 'S', 7, 7, 20, 20, 0x50000003, '#32516', 0],
                [701, 'S', 36, 9, 217, 18, SS, '', 0],
                [702, 'E', 36, 32, 217, 14, EDIT_RO, '', EDGE],
                [703, 'B', 193, 50, 60, 14, BTN, '&Copy', 0],
                [-1, 'S', 36, 68, 217, 18, SS, 'Copy this key now. It cannot be shown again.', 0],
                [1, 'B', 203, 89, 50, 14, DEFBTN, 'OK', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function api() {
        const a = root.vistaDialogTemplate;
        if (!a || typeof a.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return a;
    }

    function copy(text, c) {
        const done = () => { if (c) c.note('The key was copied to the Clipboard.'); };
        if (typeof root.copyTextToClipboard === 'function') { Promise.resolve(root.copyTextToClipboard(text)).then(done, () => {}); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    }

    function issuedDialog(c, appName, key) {
        api().openDialog({
            id: 'akmIssuedDialog',
            key: 'akm:issued',
            title: 'Key Issued',
            owner: c.modal,
            bareCaption: true,
            init: (ctx) => {
                ctx.text(701, `The request from ${appName} was approved. This is its application key:`);
                ctx.set(702, key);
                ctx.on(703, 'click', () => copy(key, c));
            }
        });
    }

    /** A checklist of purposes in a static (Certificate Properties' list view with check boxes). */
    function purposeList(prefix, chosen, disabled) {
        const all = S.scopes.filter((s) => s.id !== 'universal');
        const rows = all.map((s, i) => `<div class="vdt-lv-row akm-check-row" title="${esc(s.description || '')}"><span class="tbp-check"><input type="checkbox" id="${prefix}${i}" data-scope="${esc(s.id)}"${chosen.includes(s.id) ? ' checked' : ''}${disabled ? ' disabled' : ''}><label for="${prefix}${i}"><span>${esc(s.label || s.id)}</span></label></span></div>`).join('');
        return `<div class="vdt-listview vdt-edge is-report no-header akm-checklist${disabled ? ' is-disabled' : ''}" tabindex="0"><div class="vdt-lv-body">${rows || '<div class="akm-lv-empty">No purposes are available.</div>'}</div></div>`;
    }

    function readPurposes(holder) {
        return holder ? Array.from(holder.querySelectorAll('input[data-scope]:checked')).map((i) => i.dataset.scope) : [];
    }

    function setListEnabled(holder, on) {
        if (!holder) return;
        holder.querySelectorAll('input[data-scope]').forEach((i) => { i.disabled = !on; });
        const l = holder.querySelector('.akm-checklist');
        if (l) l.classList.toggle('is-disabled', !on);
    }

    function wizError(ctx, id, key, text) {
        ctx.html(id, text ? `<span class="akm-wiz-error"><img src="/static_images/vista-icons/error-16.png" alt="">${esc(text)}</span>` : '', key);
    }

    // ---- the key's Certificate dialog ----------------------------------------------------------------

    function keyState(k) {
        if (k.status === 'revoked') return { icon: 'cert-error', path: 'path-error', msg: 'This key has been revoked by the administrator.', status: 'This key has been revoked by the administrator.' };
        if (k.status === 'replaced') return { icon: 'cert-error', path: 'path-error', msg: 'This key was replaced by a refreshed key and no longer works.', status: 'This key was superseded by a refreshed key.' };
        if (k.status === 'expired') return { icon: 'cert-error', path: 'path-error', msg: 'This key has expired.', status: 'This key has expired.' };
        if (k.status === 'refresh_required') return { icon: 'cert-warning', path: 'path-warning', msg: 'This key must be refreshed by its program before it works again.', status: 'This key must be refreshed by its program before it works again.' };
        return { icon: 'cert-ok', path: 'path-ok', msg: '', status: 'This key is OK.' };
    }

    function fields(k) {
        const yes = (v) => (v ? 'Yes' : 'No');
        return [
            ['key', 'Key ID', k.id],
            ['key', 'Friendly name', k.keyPrefix ? `${k.keyPrefix}...` : ''],
            ['key', 'Issued to', k.appName],
            ['key', 'Client (User-Agent)', k.userAgent],
            ['key', 'Issued by', ISSUER],
            ['key', 'Valid from', longDate(k.createdAt)],
            ['key', 'Valid to', k.persistent || k.isPerpetual || !k.expiresAt ? 'Never expires' : longDate(k.expiresAt)],
            ['key', 'Original expiration', k.originalExpiresAt ? longDate(k.originalExpiresAt) : ''],
            ['set', 'Intended purposes', (Array.isArray(k.scopes) && k.scopes.length ? k.scopes : ['universal']).map(scopeLabel).join('\r\n')],
            ['set', 'Signs in as', signsInAs(k)],
            ['set', 'Persistent', yes(k.persistent)],
            ['set', 'Refresh before', k.persistent ? '' : longDate(k.refreshBeforeAt)],
            ['set', 'Keyless sign-in', yes(k.allowKeyless)],
            ['set', 'Trusted addresses', (k.trustedCidrs || []).join('\r\n') || 'Any address'],
            ['prop', 'Status', statusText(k)],
            ['prop', 'Last refreshed', longDate(k.lastRefreshedAt)],
            ['prop', 'Last used', longDate(k.lastUsedAt)],
            ['prop', 'Last used from', k.lastUsedIp || ''],
            ['prop', 'Revoked', k.revokedAt ? longDate(k.revokedAt) : '']
        ].filter((f) => f[2] !== '' && f[2] != null);
    }

    function keySheet(c, k) {
        const a = api();
        const st = keyState(k);
        const all = fields(k);
        let shown = all;
        const fillDetails = (ctx, sel) => {
            const lv = ctx.holder(101, 'akm:details');
            if (!lv) return;
            lv.querySelector('.vdt-lv-header').innerHTML = '<span class="vdt-lv-col" style="width:170px">Field</span><span class="vdt-lv-col">Value</span>';
            lv.querySelector('.vdt-lv-body').innerHTML = shown.map((f, i) => `<div class="vdt-lv-row${i === sel ? ' is-selected' : ''}" data-row="${i}"><span style="width:170px"><img src="${ART}/${f[0] === 'key' ? 'field-prop' : 'field'}-16.png" alt="">${esc(f[1])}</span><span style="width:172px">${esc(String(f[2]).replace(/\r\n/g, ', '))}</span></div>`).join('');
            ctx.set(102, sel >= 0 && shown[sel] ? String(shown[sel][2]).replace(/\r\n/g, '\n') : '', 'akm:details');
        };
        const editable = !isRevoked(k);
        a.openSheet({
            id: 'akmKeySheet',
            title: 'Application Key',
            owner: c.modal,
            bareCaption: true,
            noApply: true,
            pages: [{ key: 'akm:general', title: 'General' }, { key: 'akm:details', title: 'Details' }, { key: 'akm:path', title: 'Certification Path' }],
            init: (ctx) => {
                // the Certificate dialog has OK only, where Cancel would be
                const ok = ctx.content.querySelector('[data-vdt-action="ok"]');
                const cancel = ctx.content.querySelector('[data-vdt-action="cancel"]');
                if (ok && cancel) { ok.style.left = cancel.style.left; cancel.hidden = true; }
                // General
                const G = 'akm:general';
                ctx.html(900, `<div class="akm-cert-box"><img class="akm-cert-icon" src="${ART}/${st.icon}-32.png" alt=""><span class="akm-cert-rule" style="top:46px"></span><span class="akm-cert-rule" style="top:178px"></span></div>`, G);
                ctx.html(110, '<b>Key Information</b>', G);
                const scopes = Array.isArray(k.scopes) && k.scopes.length ? k.scopes : ['universal'];
                if (st.msg) {
                    ctx.html(116, `<b>${esc(st.msg)}</b>`, G);
                    ctx.show(111, false, G); ctx.show(103, false, G);
                } else {
                    ctx.show(116, false, G);
                    ctx.html(111, '<b>This key is intended for the following purpose(s):</b>', G);
                    ctx.html(103, `<ul class="akm-purposes">${scopes.map((s) => `<li>${esc(scopeLabel(s))}</li>`).join('')}</ul>`, G);
                }
                ctx.show(117, false, G);
                ctx.html(113, '<b>Issued to:</b>', G);
                ctx.html(105, esc(k.appName), G);
                ctx.html(114, '<b>Issued by:</b>', G);
                ctx.html(106, esc(ISSUER), G);
                ctx.html(115, k.persistent || k.isPerpetual || !k.expiresAt
                    ? `<b>Valid from</b> ${esc(date(k.createdAt))} <b>(does not expire)</b>`
                    : `<b>Valid from</b> ${esc(date(k.createdAt))} <b>to</b> ${esc(date(k.expiresAt))}`, G);
                ctx.html(118, `<img class="akm-privkey" src="${ART}/privkey-16.png" alt="">${(k.userType || 'admin') === 'admin' ? 'This key signs in as the Administrator.' : 'This key signs in as a read-only user.'}`, G);
                // Details
                const D = 'akm:details';
                ctx.options(100, [{ value: 'all', text: '<All>' }, { value: 'key', text: 'Key Fields Only' }, { value: 'set', text: 'Settings Only' }, { value: 'prop', text: 'Properties Only' }], 'all', D);
                fillDetails(ctx, -1);
                ctx.on(100, 'change', () => { const v = ctx.get(100, D); shown = v === 'all' ? all : all.filter((f) => f[0] === v); fillDetails(ctx, -1); }, D);
                // the list selects the row itself (vistaDialogTemplate wireCommon); only the value box follows
                ctx.on(101, 'click', (ev) => { const row = ev.target.closest('.vdt-lv-row'); const f = row && shown[Number(row.dataset.row)]; if (f) ctx.set(102, String(f[2]).replace(/\r\n/g, '\n'), D); }, D);
                ctx.enable(105, editable, D);
                ctx.on(105, 'click', () => { ctx.close(); editKey(c, k); }, D);
                ctx.on(103, 'click', () => {
                    const text = all.map((f) => `${f[1]}: ${String(f[2]).replace(/\r\n/g, ', ')}`).join('\r\n') + '\r\n';
                    const el = document.createElement('a');
                    el.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                    el.download = `${String(k.appName || 'key').replace(/[^\w -]+/g, '')}.txt`;
                    document.body.appendChild(el);
                    el.click();
                    setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 1000);
                }, D);
                // Certification Path: the server, the account the key signs in as, the key
                const P = 'akm:path';
                const chain = [[`${ART}/path-ok-16.png`, `${ISSUER} Server`], [`${ART}/path-ok-16.png`, signsInAs(k)], [`${ART}/${st.path}-16.png`, k.appName || 'Key']];
                ctx.html(101, chain.map(([img, t], i) => `<div class="akm-path-row${i === chain.length - 1 ? ' is-selected' : ''}" style="padding-left:${2 + i * 19}px"><img src="${img}" alt=""><span>${esc(t)}</span></div>`).join(''), P);
                ctx.set(102, st.status, P);
                ctx.content.addEventListener('click', (ev) => { if (ev.target.closest('.vdt-link')) action('help', c); });
            }
        });
    }

    // ---- Edit Properties (Certificate Properties) --------------------------------------------------

    function editKey(c, k) {
        const a = api();
        const scopes = Array.isArray(k.scopes) && k.scopes.length ? k.scopes : ['universal'];
        const universal = scopes.includes('universal');
        a.openSheet({
            id: 'akmKeyProps',
            title: 'Key Properties',
            owner: c.modal,
            bareCaption: true,
            pages: [{ key: 'akm:props', title: 'General' }, { key: 'akm:security', title: 'Security' }],
            init: (ctx) => {
                const G = 'akm:props';
                const X = 'akm:security';
                ctx.set(102, k.appName || '', G);
                ctx.set(101, k.userAgent || '', G);
                ctx.set(universal ? 104 : 106, true, G);
                ctx.html(100, purposeList('akmPropScope', universal ? [] : scopes, universal), G);
                const holder = ctx.holder(100, G);
                [104, 106].forEach((id) => ctx.on(id, 'change', () => { setListEnabled(holder, ctx.get(106, G)); ctx.dirty(); }, G));
                holder.addEventListener('change', () => ctx.dirty());
                ctx.options(201, [{ value: 'unchanged', text: 'Unchanged' }, { value: 'perpetual', text: 'Never' }, { value: '30', text: 'In 30 days' }, { value: '90', text: 'In 90 days' }, { value: '365', text: 'In 1 year' }], 'unchanged', X);
                ctx.text(202, k.persistent || k.isPerpetual || !k.expiresAt ? 'This key does not expire.' : `This key expires on ${date(k.expiresAt)}${k.status === 'expired' ? ' (expired)' : ''}.`, X);
                ctx.set(203, (k.userType || 'admin') === 'admin' && k.allowDelete !== false, X);
                ctx.set(204, !!k.persistent, X);
                ctx.set(205, !!k.allowKeyless, X);
                ctx.set(206, (k.trustedCidrs || []).join(', '), X);
                ctx.content.addEventListener('click', (ev) => { if (ev.target.closest('.vdt-link')) action('help', c); });
            },
            apply: async (ctx) => {
                const G = 'akm:props';
                const X = 'akm:security';
                const label = String(ctx.get(102, G) || '').trim();
                if (!label) { await c.box('<p>Type a friendly name for the key.</p>', null, { icon: 'warning', title: 'Key Properties' }); throw new Error('no name'); }
                let next = ctx.get(104, G) ? ['universal'] : readPurposes(ctx.holder(100, G));
                if (!next.length) next = ['universal'];
                const payload = {
                    keyId: k.id,
                    label,
                    scopes: next,
                    allowKeyless: !!ctx.get(205, X),
                    persistent: !!ctx.get(204, X),
                    allowDelete: !!ctx.get(203, X),
                    trustedCidrs: String(ctx.get(206, X) || '')
                };
                const exp = ctx.get(201, X);
                if (exp === 'perpetual') payload.perpetual = true;
                else if (exp && exp !== 'unchanged') payload.expiresInDays = parseInt(exp, 10);
                try {
                    const res = await send('update_application_key', payload);
                    if (!res || res.success === false) throw new Error((res && res.error) || 'The key could not be changed.');
                    c.note(res.unchanged ? 'The key was not changed.' : `The key for ${label} was changed.`);
                } catch (err) {
                    await c.box(`<p>${esc((err && err.message) || 'The key could not be changed.')}</p>`, null, { icon: 'error', title: 'Key Properties' });
                    throw err;
                }
                await load(c);
            }
        });
    }

    // ---- New Key wizard ---------------------------------------------------------------------------------

    function newKeyWizard(c) {
        const a = api();
        let made = null;
        let appName = '';
        a.openWizard({
            id: 'akmNewKeyWizard',
            title: 'New Application Key',
            icon: ICON32,
            owner: c.modal,
            init: (ctx) => {
                ctx.set(401, true, 'akm:new2');
                ctx.set(404, true, 'akm:new2');
                ctx.html(403, purposeList('akmNewScope', [], true), 'akm:new2');
                const holder = ctx.holder(403, 'akm:new2');
                [401, 402].forEach((id) => ctx.on(id, 'change', () => setListEnabled(holder, ctx.get(402, 'akm:new2')), 'akm:new2'));
                ctx.options(501, [{ value: 'perpetual', text: 'Never' }, { value: '30', text: 'In 30 days' }, { value: '90', text: 'In 90 days' }, { value: '365', text: 'In 1 year' }], 'perpetual', 'akm:new3');
                ctx.on(603, 'click', () => { if (made) copy(made, c); }, 'akm:done');
            },
            pages: [
                {
                    key: 'akm:new1', instruction: 'Identify the program',
                    next: (ctx) => {
                        appName = String(ctx.get(301, 'akm:new1') || '').trim();
                        const ua = String(ctx.get(302, 'akm:new1') || '').trim();
                        if (!appName) { wizError(ctx, 303, 'akm:new1', 'Type the program\'s name.'); return false; }
                        if (!ua) { wizError(ctx, 303, 'akm:new1', 'Type the client name (User-Agent) the program sends.'); return false; }
                        wizError(ctx, 303, 'akm:new1', '');
                        return 'akm:new2';
                    }
                },
                {
                    key: 'akm:new2', instruction: 'Choose what the key can do',
                    next: (ctx) => {
                        if (ctx.get(402, 'akm:new2') && !readPurposes(ctx.holder(403, 'akm:new2')).length) { wizError(ctx, 406, 'akm:new2', 'Select at least one purpose, or enable all purposes.'); return false; }
                        wizError(ctx, 406, 'akm:new2', '');
                        return 'akm:new3';
                    }
                },
                {
                    key: 'akm:new3', instruction: 'Choose how long the key works', nextText: 'Create',
                    next: async (ctx) => {
                        const exp = ctx.get(501, 'akm:new3') || 'perpetual';
                        const days = parseInt(ctx.get(502, 'akm:new3'), 10);
                        if (!Number.isFinite(days) || days < 1 || days > 3650) { wizError(ctx, 506, 'akm:new3', 'Type a number of days from 1 to 3650.'); return false; }
                        const scopes = ctx.get(401, 'akm:new2') ? ['universal'] : readPurposes(ctx.holder(403, 'akm:new2'));
                        const payload = {
                            appName,
                            userAgent: String(ctx.get(302, 'akm:new1') || '').trim(),
                            scopes,
                            userType: ctx.get(405, 'akm:new2') ? 'readonly' : 'admin',
                            perpetual: exp === 'perpetual',
                            refreshIntervalDays: days,
                            persistent: !!ctx.get(503, 'akm:new3'),
                            allowKeyless: !!ctx.get(504, 'akm:new3'),
                            trustedCidrs: String(ctx.get(505, 'akm:new3') || '')
                        };
                        if (exp !== 'perpetual') payload.expiresInDays = parseInt(exp, 10);
                        try {
                            const res = await send('create_application_key', payload);
                            if (!res || res.success === false || !res.applicationKey) throw new Error((res && res.error) || 'The key could not be created.');
                            made = res.applicationKey;
                        } catch (err) {
                            wizError(ctx, 506, 'akm:new3', (err && err.message) || 'The key could not be created.');
                            return false;
                        }
                        return 'akm:done';
                    }
                },
                {
                    key: 'akm:done', instruction: 'The key is ready', finish: true, noBack: true,
                    show: (ctx) => {
                        ctx.text(601, `${appName} can now reach Dreamscape with this key.`, 'akm:done');
                        ctx.set(602, made || '', 'akm:done');
                    }
                }
            ],
            finish: () => { void load(c); },
            cancel: () => { if (made) void load(c); }
        });
    }

    // ---- service keys --------------------------------------------------------------------------------

    function svcSel(c) {
        const s = service(String(c.node).slice(4));
        const k = s && svcKey(s, Number(String(c.sel || '').slice(4)));
        return { s, k };
    }

    async function svcUse(c) {
        const { s, k } = svcSel(c);
        if (!s || !k || k.index === inUse(s)) return;
        const ok = await c.box(`<p>Use <b>${esc(keyName(k))}</b> (${esc(k.fingerprint || '')}) for ${esc(s.label || s.id)}?</p>${s.requiresRestart ? `<p>${esc(s.label || s.id)} restarts to use the new key.</p>` : ''}`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Use This Key' });
        if (ok !== true) return;
        try {
            const res = await send('update_api_key_selections', { updates: [{ service: s.id, index: k.index }] });
            if (!res || res.success === false) throw new Error((res && res.error) || 'The key could not be selected.');
            c.note(Array.isArray(res.restartedServices) && res.restartedServices.length ? `${s.label || s.id} restarted with ${keyName(k)}.` : `${s.label || s.id} now uses ${keyName(k)}.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The key could not be selected.')}</p>`, null, { icon: 'error' });
        }
        await load(c);
    }

    async function svcDelete(c) {
        const { s, k } = svcSel(c);
        if (!s || !k) return;
        const ok = await c.box(`<p>Are you sure you want to permanently delete <b>${esc(keyName(k))}</b> from ${esc(s.label || s.id)}?</p>`,
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], { icon: 'warning', title: 'Delete Key' });
        if (ok !== true) return;
        try {
            const res = await send('delete_api_key', { service: s.id, index: k.index });
            if (!res || res.success === false) throw new Error((res && res.error) || 'The key could not be deleted.');
            c.note(`${keyName(k)} was deleted.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The key could not be deleted.')}</p>`, null, { icon: 'error' });
        }
        c.sel = null;
        await load(c);
    }

    async function svcUnlock(c) {
        const s = service(String(c.node).slice(4));
        if (!s) return;
        try {
            await send('unlock_api_service', { service: s.id });
            c.note(`${s.label || s.id} was unlocked.`);
        } catch (err) {
            await c.box(`<p>${esc((err && err.message) || 'The service could not be unlocked.')}</p>`, null, { icon: 'error' });
        }
        await load(c);
    }

    /** Add Key / Edit Key: a dialog laid out for the service (its key label, extra fields, a second credential). */
    function svcKeyDialog(c, s, k) {
        if (!s) return;
        const a = api();
        const editing = !!k;
        const extra = Array.isArray(s.fields) ? s.fields : [];
        const ctl = [];
        let y = 7;
        ctl.push([-1, 'S', 7, y + 2, 70, 8, SS, '&Name:', 0], [801, 'E', 80, y, 173, 14, EDIT, '', EDGE]);
        y += 20;
        ctl.push([-1, 'S', 7, y + 2, 70, 8, SS_NOPREFIX, `${s.keyLabel || 'Key value'}:`, 0], [802, 'E', 80, y, s.keyFileAccept ? 118 : 173, 14, EDIT, '', EDGE]);
        if (s.keyFileAccept) ctl.push([803, 'B', 201, y, 52, 14, BTN, 'B&rowse...', 0]);
        y += 20;
        extra.forEach((f, i) => {
            ctl.push([-1, 'S', 7, y + 2, 70, 8, SS_NOPREFIX, `${f.label}:`, 0], [810 + i, 'E', 80, y, 173, 14, EDIT, '', EDGE]);
            y += 20;
        });
        if (s.secondary) {
            ctl.push([-1, 'S', 7, y + 2, 70, 8, SS_NOPREFIX, `${s.secondary.label}${s.secondary.optional ? ' (optional)' : ''}:`, 0], [804, 'E', 80, y, 173, 14, EDIT, '', EDGE]);
            y += 18;
            if (s.secondary.hint) { ctl.push([-1, 'S', 80, y, 173, 16, SS_NOPREFIX, s.secondary.hint, 0]); y += 18; }
            if (editing && k.secondaryFingerprint) { ctl.push([805, 'B', 80, y, 173, 10, CHECK, `Remove the ${s.secondary.label.toLowerCase()}`, 0]); y += 14; }
            y += 4;
        }
        if (editing) { ctl.push([-1, 'S', 80, y, 173, 16, SS, 'Leave a box empty to keep what the key has now.', 0]); y += 20; }
        if (s.howTo) { ctl.push([806, 'S', 7, y, 246, 70, SS, '', 0]); y += 74; }
        ctl.push([807, 'S', 7, y, 186, 16, SS, '', 0]);
        ctl.push([1, 'B', 149, y + 4, 50, 14, DEFBTN, 'OK', 0], [2, 'B', 203, y + 4, 50, 14, BTN, 'Cancel', 0]);
        const tpl = { t: '', w: 260, h: y + 25, f: ['MS Shell Dlg', 8], s: 0, c: ctl };
        a.openDialog({
            id: 'akmSvcKeyDialog',
            tpl,
            title: `${editing ? 'Edit Key' : 'Add Key'} - ${s.label || s.id}`,
            owner: c.modal,
            bareCaption: true,
            focusFirst: true,
            init: (ctx) => {
                if (editing) {
                    ctx.set(801, keyName(k));
                    const el = ctx.el(802);
                    if (el) el.placeholder = 'Leave blank to keep the current key';
                    extra.forEach((f, i) => ctx.set(810 + i, (k.fields && k.fields[f.field]) || ''));
                } else {
                    extra.forEach((f, i) => { const el = ctx.el(810 + i); if (el) el.placeholder = f.placeholder || ''; });
                }
                if (s.howTo) {
                    const h = s.howTo;
                    const steps = Array.isArray(h.steps) ? h.steps : [];
                    const links = (Array.isArray(h.links) ? h.links : []).filter(([, url]) => /^https:\/\//.test(String(url || '')));
                    ctx.html(806, `<div class="akm-howto"><b>${esc(h.title || 'How to get this key')}</b>${steps.length ? `<ol>${steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}${links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-browser-tab>${esc(label)}</a>`).join(' ')}</div>`);
                }
                if (s.keyFileAccept) {
                    ctx.on(803, 'click', () => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = s.keyFileAccept;
                        input.onchange = () => {
                            const f = input.files && input.files[0];
                            if (!f || f.size > 16384) return;
                            const r = new FileReader();
                            r.onload = () => {
                                ctx.set(802, String(r.result || '').trim());
                                const m = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(f.name);
                                const at = extra.findIndex((x) => x.field === 'keyId');
                                if (m && at >= 0 && !String(ctx.get(810 + at) || '').trim()) ctx.set(810 + at, m[1].toUpperCase());
                            };
                            r.readAsText(f);
                        };
                        input.click();
                    });
                }
            },
            ok: async (ctx) => {
                const name = String(ctx.get(801) || '').trim();
                const value = String(ctx.get(802) || '').trim();
                const secondaryKey = s.secondary ? String(ctx.get(804) || '').trim() : '';
                const clearSecondary = !!(editing && ctx.el(805) && ctx.get(805) && !secondaryKey);
                const vals = {};
                extra.forEach((f, i) => { const v = String(ctx.get(810 + i) || '').trim(); if (v) vals[f.field] = f.upper ? v.toUpperCase() : v; });
                const fieldsOut = Object.keys(vals).length ? vals : undefined;
                const fail = (t) => { ctx.html(807, `<span class="akm-wiz-error"><img src="/static_images/vista-icons/error-16.png" alt="">${esc(t)}</span>`); return false; };
                try {
                    if (editing) {
                        if (!name && !value && !secondaryKey && !clearSecondary && !fieldsOut) return fail('Type a new name or key value.');
                        const res = await send('update_api_key', { service: s.id, index: k.index, name: name || undefined, apiKey: value || undefined, secondaryKey: secondaryKey || undefined, clearSecondary: clearSecondary || undefined, fields: fieldsOut });
                        if (!res || res.success === false) throw new Error((res && res.error) || 'The key could not be changed.');
                        c.note(`${name || keyName(k)} was changed.`);
                    } else {
                        if (!name || !value) return fail('Type a name and the key value.');
                        const res = await send('add_api_key', { service: s.id, name, apiKey: value, secondaryKey: secondaryKey || undefined, fields: fieldsOut });
                        if (!res || res.success === false) throw new Error((res && res.error) || 'The key could not be added.');
                        c.note(`${name} was added to ${s.label || s.id}.`);
                    }
                } catch (err) {
                    return fail((err && err.message) || 'The key could not be saved.');
                }
                void load(c);
                return true;
            }
        });
    }

    /** api_key_status_changed (modules/apiKeyHealth.js, to admins): new health without a reload. */
    function onStatus(c) {
        return (packet) => {
            const statuses = packet && packet.data && packet.data.statuses;
            if (!statuses) return;
            S.services.forEach((s) => {
                const rows = Array.isArray(statuses[s.id]) ? statuses[s.id] : [];
                const field = s.secondary && s.secondary.field;
                rows.forEach((row) => {
                    const k = svcKey(s, row.index);
                    if (!k) return;
                    if (row.apiKey) k.status = row.apiKey;
                    if (field && row[field]) k.secondaryStatus = row[field];
                });
            });
            if (!c.isActive || c.isActive()) {
                const n = String(c.node || '');
                if (n === 'svc' || n.startsWith('svc:')) c.refresh();
            }
        };
    }

    // ---- open -------------------------------------------------------------------------------------------

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            width: 860,
            treeWidth: 200,
            expanded: ['root', 'app'],
            nodes,
            page,
            commands,
            selCommands,
            toolbar: (node) => {
                if (node.id === 'root') return [];
                const own = [{ id: 'refresh', i: 3, title: 'Refresh' }];
                if (isList(node.id)) own.push({ id: 'export', i: 16, title: 'Export List' });
                return own;
            },
            action,
            rowOpen,
            status,
            about: { version: '1.0.0', lines: ['Key Manager keeps the keys programs use to reach Dreamscape and the keys Dreamscape uses for outside services.'] },
            onOpen: (c) => {
                if (ws() && typeof ws().on === 'function' && !S.statusHandler) {
                    S.statusHandler = onStatus(c);
                    ws().on('api_key_status_changed', S.statusHandler);
                }
                // client_cert_changed (modules/clientCertificates.js, to admins): a certificate was issued or revoked
                if (ws() && typeof ws().on === 'function' && !S.certHandler) {
                    S.certHandler = () => { void load(c); };
                    ws().on('client_cert_changed', S.certHandler);
                }
                void load(c);
            },
            onClose: () => {
                if (S.statusHandler && ws() && typeof ws().off === 'function') ws().off('api_key_status_changed', S.statusHandler);
                S.statusHandler = null;
                if (S.certHandler && ws() && typeof ws().off === 'function') ws().off('client_cert_changed', S.certHandler);
                S.certHandler = null;
                S.log.loaded = false;
            }
        };
    }

    async function openKeyManager(node) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        return root.mmcConsole.open(def(), node ? { node } : {});
    }

    root.openKeyManager = openKeyManager;
    root.mmcAppKeys = { open: openKeyManager, def, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
