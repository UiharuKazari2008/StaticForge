/**
 * Plaid bank balances for the Wallet (Yozora #1123).
 *
 * Client keys: Service key `plaid` (apiKey = the Plaid secret, `clientId` field). Linked items live in
 * secure config `plaidItems`; an access token never leaves this module.
 *
 * Only Plaid's free calls are used: /accounts/get (cached balances; never the billed /accounts/balance/get),
 * /item/get, /institutions/get_by_id, /link/token/create, /link/token/get, /item/public_token/exchange.
 *
 * No timer reads balances: a refresh happens only when a client asks (`getStatus({ refresh: true })`), for the
 * items last checked more than 30 minutes ago, one refresh in flight at a time. The one wait that exists is
 * the Hosted Link watcher: started by the user's plaid_link_start, one per item, every 5 s for at most
 * 30 minutes, cleared when the session ends.
 */
const REFRESH_MS = 30 * 60 * 1000;
const CALL_TIMEOUT_MS = 12000;
const ANSWER_WAIT_MS = 12000;
const WATCH_EVERY_MS = 5000;
const WATCH_MAX_MS = 30 * 60 * 1000;
const BASE = { production: 'https://production.plaid.com', development: 'https://development.plaid.com', sandbox: 'https://sandbox.plaid.com' };
const ITEMS_PATH = 'plaidItems';

let gr = null;
let inflight = null;
const watchers = new Map(); // key (itemId or 'new') -> { timer, startedAt, linkToken, itemId }
const checkedAt = new Map(); // itemId -> ms of the last refresh attempt (not persisted: a restart may read once)

function attach(globalResources) {
    gr = globalResources || null;
}

// ------------------------------------------------------------------------------------------ keys and http

function credentials() {
    try {
        const manager = gr && gr.getApiKeyManager && gr.getApiKeyManager();
        if (!manager) return null;
        const k = manager.getServiceKeys('plaid')[manager.getSelectedIndex('plaid')];
        return k && k.apiKey && k.clientId ? { secret: String(k.apiKey), clientId: String(k.clientId) } : null;
    } catch (_e) {
        return null;
    }
}

function baseUrl() {
    let env = 'production';
    try {
        const c = gr && gr.getConfig && gr.getConfig({ path: 'plaid' });
        if (c && BASE[c.env]) env = c.env;
    } catch (_e) { /* default */ }
    return BASE[env];
}

/** { ok, status, body } for any answer Plaid gives; { ok:false, network:true, error_code } when it did not answer. */
async function post(path, body) {
    const cred = credentials();
    if (!cred) return { ok: false, status: 0, body: { error_code: 'NOT_CONFIGURED', error_message: 'No Plaid service key (client id and secret) is set' } };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
    try {
        const res = await fetch(baseUrl() + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'PLAID-CLIENT-ID': cred.clientId, 'PLAID-SECRET': cred.secret },
            body: JSON.stringify(body || {}),
            signal: ctl.signal
        });
        let json = {};
        try { json = await res.json(); } catch (_e) { json = {}; }
        return { ok: res.ok, status: res.status, body: json || {} };
    } catch (e) {
        return { ok: false, status: 0, network: true, body: { error_code: e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', error_message: 'Plaid did not answer' } };
    } finally {
        clearTimeout(timer);
    }
}

const errCode = (r) => (r && r.body && r.body.error_code) || (r && r.network ? 'NETWORK' : 'UNKNOWN');
const needsLogin = (code) => code === 'ITEM_LOGIN_REQUIRED' || code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT';

// ------------------------------------------------------------------------------------------ items store

function readItems() {
    try {
        const v = gr.getSecureConfig({ path: ITEMS_PATH, clone: true });
        return Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : [];
    } catch (_e) {
        return [];
    }
}

async function writeItems(items) {
    try {
        await gr.modifyConfig('secureConfig').assign(ITEMS_PATH, items);
    } catch (e) {
        console.warn(`[plaid] items not saved: ${e.message}`);
    }
}

function accountRow(a) {
    return {
        accountId: a.account_id, name: a.name || '', officialName: a.official_name || '', mask: a.mask || '',
        type: a.type || '', subtype: a.subtype || ''
    };
}

function balanceRow(a) {
    const b = a.balances || {};
    return {
        available: typeof b.available === 'number' ? b.available : null,
        current: typeof b.current === 'number' ? b.current : null,
        isoCurrencyCode: b.iso_currency_code || b.unofficial_currency_code || 'USD'
    };
}

function publicItem(it) {
    return {
        itemId: it.itemId,
        institutionName: it.institutionName || '',
        label: it.label || it.institutionName || '',
        status: it.status === 'ok' || it.status === 'login_required' ? it.status : 'error',
        ...(it.errorCode ? { errorCode: it.errorCode } : {}),
        fetchedAt: it.fetchedAt || null,
        accounts: (it.accounts || []).map((a) => Object.assign({}, a, {
            available: it.balances && it.balances[a.accountId] ? it.balances[a.accountId].available : null,
            current: it.balances && it.balances[a.accountId] ? it.balances[a.accountId].current : null,
            isoCurrencyCode: it.balances && it.balances[a.accountId] ? it.balances[a.accountId].isoCurrencyCode : 'USD'
        }))
    };
}

function statusData(items) {
    const list = items || readItems();
    return { success: true, configured: !!credentials(), items: list.map(publicItem) };
}

/** Everything a page shows except clock fields; the push goes out only when this changed. */
function changeKey(items) {
    return JSON.stringify(items.map((it) => [it.itemId, it.status, it.errorCode || '', it.label || '',
        (it.accounts || []).map((a) => [a.accountId, it.balances && it.balances[a.accountId]])]));
}

// ------------------------------------------------------------------------------------------ plaid reads

/** Applies /accounts/get (or its error) onto the item in place. Returns true when Plaid answered. */
async function readAccounts(item) {
    const r = await post('/accounts/get', { access_token: item.accessToken });
    if (r.ok && Array.isArray(r.body.accounts)) {
        item.accounts = r.body.accounts.map(accountRow);
        item.balances = {};
        r.body.accounts.forEach((a) => { item.balances[a.account_id] = balanceRow(a); });
        item.status = 'ok';
        delete item.errorCode;
        item.fetchedAt = new Date().toISOString();
        return true;
    }
    const code = errCode(r);
    if (r.network) return false; // keep what is known
    item.status = needsLogin(code) ? 'login_required' : 'error';
    item.errorCode = code;
    return true;
}

async function institutionName(institutionId) {
    if (!institutionId) return '';
    const r = await post('/institutions/get_by_id', { institution_id: institutionId, country_codes: ['US'] });
    return r.ok && r.body.institution ? String(r.body.institution.name || '') : '';
}

/** Stores an item from a bare access token (also while the item answers ITEM_LOGIN_REQUIRED). */
async function importAccessToken(accessToken, label) {
    if (!accessToken || typeof accessToken !== 'string') return { success: false, error: 'An access token is required' };
    const got = await post('/item/get', { access_token: accessToken });
    if (!got.ok || !got.body.item) return { success: false, error: errCode(got) };
    const meta = got.body.item;
    const items = readItems();
    const before = changeKey(items);
    let item = items.find((i) => i.itemId === meta.item_id);
    if (!item) {
        item = { itemId: meta.item_id, accounts: [], balances: {} };
        items.push(item);
    }
    item.accessToken = accessToken;
    item.institutionId = meta.institution_id || item.institutionId || '';
    if (label) item.label = String(label);
    if (!item.institutionName) item.institutionName = await institutionName(item.institutionId);
    if (!item.label) item.label = item.institutionName;
    const itemErr = meta.error && meta.error.error_code;
    if (itemErr && needsLogin(itemErr)) {
        item.status = 'login_required';
        item.errorCode = itemErr;
    } else {
        await readAccounts(item);
    }
    checkedAt.set(item.itemId, Date.now());
    await writeItems(items);
    announce(items, before);
    return { success: true, item: publicItem(item) };
}

// ------------------------------------------------------------------------------------------ refresh and status

async function doRefresh(force, onlyItemId) {
    const items = readItems();
    const before = changeKey(items);
    const now = Date.now();
    const due = items.filter((i) => (!onlyItemId || i.itemId === onlyItemId)
        && (force || now - (checkedAt.get(i.itemId) || 0) > REFRESH_MS));
    if (!due.length) return;
    await Promise.all(due.map(async (item) => {
        // an item that did not answer is tried again at the next ask, not held for 30 minutes
        if (await readAccounts(item)) checkedAt.set(item.itemId, Date.now());
    }));
    await writeItems(items);
    announce(items, before);
}

function refresh(force, onlyItemId) {
    if (!inflight) {
        inflight = doRefresh(force, onlyItemId).catch((e) => console.warn(`[plaid] refresh failed: ${e.message}`)).finally(() => { inflight = null; });
    }
    return inflight;
}

/** plaid_status: from the saved items; with refresh a stale read is awaited for at most 12 s. */
async function getStatus(opts) {
    if (opts && opts.refresh && credentials()) {
        const p = refresh(false);
        let timer;
        await Promise.race([p, new Promise((resolve) => { timer = setTimeout(resolve, ANSWER_WAIT_MS); })]);
        clearTimeout(timer);
    }
    return statusData();
}

function server() {
    return gr && (gr.getWebSocketServer ? gr.getWebSocketServer() : gr.webSocketServer);
}

const adminClient = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));

/** plaid_balances to the admin phones: `before` is changeKey() of the items before the change; no push without a change. */
function announce(items, before) {
    if (before !== undefined && changeKey(items) === before) return;
    try {
        const srv = server();
        if (srv && typeof srv.broadcast === 'function') {
            srv.broadcast({ type: 'plaid_balances', data: statusData(items), timestamp: new Date().toISOString() }, adminClient);
        }
    } catch (e) {
        console.warn(`[plaid] push skipped: ${e.message}`);
    }
}

// ------------------------------------------------------------------------------------------ link (Hosted Link)

// A new item needs a product. This client is enabled for `liabilities` and `transactions` only (auth, identity,
// assets and investments answer INVALID_PRODUCT, Nov 25 2026); the balance itself comes free with any of them.
const NEW_ITEM_PRODUCTS = ['liabilities', 'transactions'];

function linkBody(item, hosted, products) {
    const body = {
        client_name: 'Dreamscape', language: 'en', country_codes: ['US'], user: { client_user_id: 'yukimi' }
    };
    if (item) body.access_token = item.accessToken; else body.products = products;
    if (hosted) body.hosted_link = {};
    return body;
}

function stopWatcher(key) {
    const w = watchers.get(key);
    if (!w) return;
    clearTimeout(w.timer);
    watchers.delete(key);
}

function cancelLinks() {
    const n = watchers.size;
    Array.from(watchers.keys()).forEach(stopWatcher);
    return n;
}

async function finishLink(key, itemId, session) {
    if (itemId) {
        const before = changeKey(readItems());
        await refresh(true, itemId); // pushes itself when something moved
        if (changeKey(readItems()) === before) announce(readItems()); // a link finished: pushed even when nothing moved
        return;
    }
    const results = (session && session.results && session.results.item_add_results) || [];
    const publicToken = results[0] && results[0].public_token;
    if (!publicToken) {
        console.warn('[plaid] link finished without a new item');
        return;
    }
    const ex = await post('/item/public_token/exchange', { public_token: publicToken });
    if (!ex.ok || !ex.body.access_token) {
        console.warn(`[plaid] link exchange failed: ${errCode(ex)}`);
        return;
    }
    await importAccessToken(ex.body.access_token, ''); // a new item changes the list, so it pushes itself
}

async function watchStep(key, itemId, linkToken) {
    const w = watchers.get(key);
    if (!w || w.linkToken !== linkToken) return;
    if (Date.now() - w.startedAt > WATCH_MAX_MS) { stopWatcher(key); return; }
    let done = false;
    let session = null;
    const r = await post('/link/token/get', { link_token: linkToken });
    if (!watchers.has(key) || watchers.get(key).linkToken !== linkToken) return;
    if (!r.ok && !r.network) {
        console.warn(`[plaid] link watch ended: ${errCode(r)}`);
        stopWatcher(key);
        return;
    }
    if (r.ok) {
        const sessions = Array.isArray(r.body.link_sessions) ? r.body.link_sessions : [];
        session = sessions.find((s) => s && (s.finished_at || s.exit || (s.results && s.results.item_add_results && s.results.item_add_results.length))) || null;
        if (session && session.exit && !(session.results && session.results.item_add_results && session.results.item_add_results.length)) {
            stopWatcher(key); // closed without finishing
            return;
        }
        done = !!session;
    }
    if (done) {
        stopWatcher(key);
        try { await finishLink(key, itemId, session); } catch (e) { console.warn(`[plaid] link finish failed: ${e.message}`); }
        return;
    }
    const cur = watchers.get(key);
    if (cur) {
        cur.timer = setTimeout(() => { watchStep(key, itemId, linkToken); }, WATCH_EVERY_MS);
        if (cur.timer.unref) cur.timer.unref();
    }
}

function startWatcher(key, itemId, linkToken) {
    stopWatcher(key); // at most one per item
    const w = { startedAt: Date.now(), linkToken, itemId, timer: null };
    watchers.set(key, w);
    w.timer = setTimeout(() => { watchStep(key, itemId, linkToken); }, WATCH_EVERY_MS);
    if (w.timer.unref) w.timer.unref();
}

/** plaid_link_start: Hosted Link url (update mode with itemId); the Link SDK token when Plaid refuses hosted_link. */
async function linkStart(itemId) {
    if (!credentials()) return { success: false, error: 'NOT_CONFIGURED' };
    let item = null;
    if (itemId) {
        item = readItems().find((i) => i.itemId === itemId);
        if (!item) return { success: false, error: 'UNKNOWN_ITEM' };
    }
    const key = itemId || 'new';
    let r = null;
    let hostedCode = null;
    for (const products of item ? [null] : NEW_ITEM_PRODUCTS.map((p) => [p])) {
        r = await post('/link/token/create', linkBody(item, true, products));
        if (r.ok && r.body.link_token && r.body.hosted_link_url) {
            startWatcher(key, itemId || null, r.body.link_token);
            return { success: true, hostedLinkUrl: r.body.hosted_link_url, expiration: r.body.expiration || null };
        }
        if (r.network) return { success: false, error: errCode(r) };
        hostedCode = errCode(r);
        if (hostedCode !== 'INVALID_PRODUCT') {
            // Plaid refused hosted_link itself: the page opens the Link SDK with the token instead (no watcher: the page completes it)
            const sdk = await post('/link/token/create', linkBody(item, false, products));
            if (sdk.ok && sdk.body.link_token) {
                console.warn(`[plaid] hosted link refused (${hostedCode}); the page opens the Link SDK instead`);
                return { success: true, hostedLinkUrl: null, linkToken: sdk.body.link_token, expiration: sdk.body.expiration || null, hostedLinkError: hostedCode };
            }
            return { success: false, error: errCode(sdk) };
        }
    }
    return { success: false, error: hostedCode || 'UNKNOWN' };
}

module.exports = {
    attach, getStatus, importAccessToken, linkStart, cancelLinks,
    _test: { post, readItems, watchers, checkedAt, refresh }
};
