/**
 * DSAP (DreamScape Activity Protocol) + Grimoire Domain registry.
 *
 * This is the single source of truth for "domain name (with aliases) resolves to applet or handler".
 *
 * - All pseudo-browser navigation (edtx://, rdf://, dsap://, bare en.grimoire.jp, wiki.danbooru.jp, docs.novelai.jp, applet.* etc.)
 *   should go through resolveDsap + navigateDsapIfMatched (or the higher level shell.navigate).
 * - Core built-in surfaces (search, home, tag wikis from danbooru/e621, static docs) are registered
 *   alongside dynamic applets in grimoireCoreDomains.js and individual applet files.
 * - The TagWikiSearchModal (and panes / standalone windows) should act as a thin router + generic chrome.
 *   Hard-coded if-chains for routing belong here (the registry), not in the modal.
 *
 * Register with registerDsap({ url, aliases?, title, assets?, getContent?, shimActivate?, activate?, menuEntry? }).
 * menuEntry: { launchId?, icon?, imageIcon?, text?, location?, startMenuLocation?, appMenuLocation?,
 *   index?, startMenuIndex?, appMenuIndex?, startMenu?, appMenu?, launch?, desktopOnly? }
 * startMenu/appMenu default true; location defaults: startMenuLocation/tools via location, appMenuLocation 'all-apps'.
 * Use appMenuLocation 'tools' (or appMenu: false) to control in-window app menu placement.
 * - activate(shell, match) gives full control (used by core domains and complex shims).
 * - getContent(match) + drivers for self-contained hosted content.
 * - Host context menus: host.registerContextMenuItems / registerContextMenuAction + data-dsap-ctx-* attrs
 *   (see collectDsapHostContextMenuItems / dispatchDsapContextMenuAction; Grimoire chrome in tagWikiSearchModal.js).
 * - See grimoireCoreDomains.js and dsapManifests.js for examples.
 *
 * Grimoire navigate/render: public/scripts/comp/tagWikiSearchModal.js
 */

const dsapRegistryEntries = [];
let dsapHostRootsCache = null;
let dsapStyleCounter = 0;

function invalidateDsapHostCache() {
    dsapHostRootsCache = null;
}

/** All registered DSAP entries (read-only snapshot). */
function getRegisteredDsaps() {
    return dsapRegistryEntries.slice();
}

function collectDsapHostRoots() {
    if (dsapHostRootsCache) return dsapHostRootsCache;

    const roots = new Set();
    for (const entry of dsapRegistryEntries) {
        [entry.url, ...(entry.aliases || [])].forEach((candidate) => {
            const norm = normalizeDsapUrlInput(candidate);
            if (!norm) return;
            roots.add(norm.split('/')[0].toLowerCase());
            roots.add(norm.toLowerCase());
        });
    }

    dsapHostRootsCache = roots;
    return roots;
}

/** True when url matches a registered DSAP host/path or uses the dsap:// scheme. */
function isDsapPseudoUrl(url) {
    const val = String(url || '').trim();
    if (!val) return false;
    if (/^dsap:\/\//i.test(val)) return true;
    if (resolveDsap(val)) return true;

    const normalized = normalizeDsapUrlInput(val);
    if (!normalized) return false;

    const lower = normalized.toLowerCase();
    for (const root of collectDsapHostRoots()) {
        if (lower === root || lower.startsWith(`${root}/`)) return true;
    }
    return false;
}

const DSAP_DEFAULT_START_MENU_LOCATION = 'tools';
const DSAP_DEFAULT_APP_MENU_LOCATION = 'all-apps';

function normalizeDsapMenuLocation(location) {
    if (!location || location === 'root') return 'root';
    let loc = String(location).trim().toLowerCase().replace(/\s+/g, '-');
    if (loc === 'installed-applets' || loc === 'tools/installed-applets') return 'tools';
    if (loc === 'tools' || loc === 'none') return loc;
    return loc;
}

function normalizeDsapAppMenuLocation(location) {
    if (!location || location === 'all-apps' || location === 'allapps') return 'all-apps';
    return String(location).trim().toLowerCase().replace(/\s+/g, '-');
}

function resolveDsapMenuEntryIndex(me, menuKind) {
    const specificKey = menuKind === 'appMenu' ? 'appMenuIndex' : 'startMenuIndex';
    if (typeof me[specificKey] === 'number') return me[specificKey];
    if (typeof me.index === 'number') return me.index;
    return undefined;
}

function resolveDsapMenuEntryLocation(me, menuKind) {
    const specificKey = menuKind === 'appMenu' ? 'appMenuLocation' : 'startMenuLocation';
    const raw = me[specificKey] ?? me.location
        ?? (menuKind === 'appMenu' ? DSAP_DEFAULT_APP_MENU_LOCATION : DSAP_DEFAULT_START_MENU_LOCATION);
    return menuKind === 'appMenu'
        ? normalizeDsapAppMenuLocation(raw)
        : normalizeDsapMenuLocation(raw);
}

function sortDsapMenuEntryItems(items, indexPicker) {
    return items
        .map((item, seq) => ({
            item,
            index: typeof indexPicker(item) === 'number' ? indexPicker(item) : seq,
            seq
        }))
        .sort((a, b) => (a.index - b.index) || (a.seq - b.seq))
        .map((entry) => entry.item);
}

function resolveDsapMenuEntryConfig(entry) {
    return entry.menuEntry || entry.toolbox || null;
}

/** Menu rows contributed by registered DSAP applets (menuEntry on each registration). */
function getDsapMenuEntries() {
    const items = [];
    for (const entry of dsapRegistryEntries) {
        const me = resolveDsapMenuEntryConfig(entry);
        if (!me) continue;

        const launchId = me.launchId || `dsap-${normalizeDsapUrlInput(entry.url).replace(/[^a-z0-9]+/gi, '-')}`;
        const text = me.text || entry.title || entry.url;
        const icon = me.icon || 'fas fa-puzzle-piece';

        let action = null;
        if (typeof me.launch === 'function') {
            action = me.launch;
        } else if (typeof openDsapInGrimoire === 'function') {
            const launchUrl = me.url || `dsap://${normalizeDsapUrlInput(entry.url)}`;
            action = () => openDsapInGrimoire(launchUrl);
        }

        if (!action) continue;

        items.push({
            launchId,
            icon,
            imageIcon: me.imageIcon,
            text,
            fullName: me.fullName,
            location: resolveDsapMenuEntryLocation(me, 'startMenu'),
            startMenuLocation: resolveDsapMenuEntryLocation(me, 'startMenu'),
            appMenuLocation: resolveDsapMenuEntryLocation(me, 'appMenu'),
            index: resolveDsapMenuEntryIndex(me, 'startMenu'),
            startMenuIndex: resolveDsapMenuEntryIndex(me, 'startMenu'),
            appMenuIndex: resolveDsapMenuEntryIndex(me, 'appMenu'),
            startMenu: me.startMenu !== false,
            appMenu: me.appMenu !== false,
            appRootOnly: !!me.appRootOnly,
            desktopOnly: !!me.desktopOnly,
            action
        });
    }
    return items;
}

function getDsapStartMenuEntriesAtLocation(location) {
    const norm = normalizeDsapMenuLocation(location);
    const items = getDsapMenuEntries().filter((item) => {
        if (item.startMenu === false) return false;
        if (item.startMenuLocation === 'none') return false;
        return item.startMenuLocation === norm;
    });
    return sortDsapMenuEntryItems(items, (item) => item.startMenuIndex);
}

function getDsapAppMenuEntries() {
    const items = getDsapMenuEntries().filter((item) => {
        if (item.appMenu === false) return false;
        return item.appMenuLocation === 'all-apps';
    });
    return sortDsapMenuEntryItems(items, (item) => item.appMenuIndex);
}

/** @deprecated Use getDsapStartMenuEntriesAtLocation */
function getDsapMenuEntriesAtLocation(location) {
    return getDsapStartMenuEntriesAtLocation(location);
}

/** Minimum time the address bar stays in loading state so navigation feels visible */
const GRIMOIRE_NAV_LOADING_MIN_MS = 360;

function grimoireGetNavLoadingDelayMs(startedAt) {
    const start = startedAt || Date.now();
    return Math.max(0, GRIMOIRE_NAV_LOADING_MIN_MS - (Date.now() - start));
}

function grimoireGetUnsupportedProtocol(url) {
    const m = String(url || '').trim().match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!m) return null;
    const proto = m[1].toLowerCase();
    if (proto === 'edtx' || proto === 'rdf' || proto === 'dsap') return null;
    return proto;
}

function isGrimoirePseudoBrowserAddress(url) {
    const val = String(url || '').trim();
    if (!val) return false;
    if (/^(edtx|rdf|dsap):\/\//i.test(val)) return true;
    if (isDsapPseudoUrl(val)) return true;
    if (/^(en\.|wiki\.|applet\.|dsap\.|docs\.|grimoire\.)/i.test(val)) return true;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(val)) return true;
    return false;
}

function grimoireNormalizePseudoDisplayUrl(url) {
    let fullUrl = String(url || '').trim();
    if (!fullUrl) return { displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' };

    let mode = 'edtx';
    const lower = fullUrl.toLowerCase();
    if (isDsapPseudoUrl(fullUrl)) {
        mode = 'dsap';
    } else if (/^rdf:\/\//i.test(fullUrl) || lower.includes('docs.')) {
        mode = 'rdf';
    }

    if (!/^(edtx|rdf|dsap):\/\//i.test(fullUrl)) {
        if (mode === 'dsap') {
            fullUrl = `dsap://${fullUrl.replace(/^\/+/, '')}`;
        } else if (mode === 'rdf') {
            fullUrl = `rdf://${fullUrl.replace(/^\/+/, '')}`;
        } else {
            fullUrl = `edtx://${fullUrl.replace(/^\/+/, '')}`;
        }
    }

    return { displayUrl: fullUrl, mode };
}

/** Path portion of a pseudo-URL with edtx/rdf/dsap scheme removed (for routing). */
function grimoireStripPseudoProtocol(url) {
    return String(url || '').trim().replace(/^(edtx|rdf|dsap):\/\//i, '');
}

function normalizeDsapUrlInput(url) {
    let raw = String(url || '').trim();
    if (!raw) return '';

    raw = raw.replace(/^(edtx|rdf|dsap):\/\//i, '');
    raw = raw.replace(/^\/+/, '');

    try {
        const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
        const host = parsed.hostname.toLowerCase();
        let path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        const query = parsed.search ? parsed.search.slice(1) : '';
        return query ? `${host}/${path}?${query}` : (path ? `${host}/${path}` : host);
    } catch (e) {
        return raw.toLowerCase().replace(/^\/+|\/+$/g, '');
    }
}

function dsapUrlMatches(entry, normalized) {
    const candidates = [entry.url, ...(entry.aliases || [])]
        .map((u) => normalizeDsapUrlInput(u))
        .filter(Boolean);

    for (const candidate of candidates) {
        if (normalized === candidate) return true;
        if (normalized.startsWith(`${candidate}/`)) return true;
    }
    return false;
}

function resolveDsap(url) {
    const normalized = normalizeDsapUrlInput(url);
    if (!normalized) return null;

    for (const entry of dsapRegistryEntries) {
        if (dsapUrlMatches(entry, normalized)) {
            const canonicalBase = normalizeDsapUrlInput(entry.url);
            const canonicalHost = canonicalBase.split('/')[0];
            const qIdx = normalized.indexOf('?');
            const normalizedPath = qIdx >= 0 ? normalized.slice(0, qIdx) : normalized;
            const query = qIdx >= 0 ? normalized.slice(qIdx) : '';
            let pathBase;
            if (normalizedPath === canonicalBase || normalizedPath.startsWith(`${canonicalHost}/`)) {
                const suffix = normalizedPath.startsWith(canonicalHost)
                    ? normalizedPath.slice(canonicalHost.length).replace(/^\//, '')
                    : '';
                pathBase = suffix ? `${canonicalHost}/${suffix}` : canonicalHost;
            } else {
                // Cross-domain alias (e.g. xi.dyna.dreamscape.jp/persona → memories DSAP)
                pathBase = normalizedPath;
            }
            return {
                entry,
                normalized,
                displayPath: `${pathBase}${query}`,
                canonicalUrl: `dsap://${pathBase}${query}`
            };
        }
    }
    return null;
}

function getDsapRegistryEntry(entryOrUrl) {
    const url = typeof entryOrUrl === 'string' ? entryOrUrl : entryOrUrl?.url;
    if (!url) return null;
    return dsapRegistryEntries.find((e) => e.url === url) || null;
}

function registerDsap(config) {
    if (!config || !config.url) {
        console.warn('registerDsap: missing url');
        return;
    }
    const existing = dsapRegistryEntries.findIndex((e) => e.url === config.url);
    if (existing >= 0) {
        const target = dsapRegistryEntries[existing];
        if (config.aliases) target.aliases = config.aliases;
        if (config.assets) target.assets = config.assets;
        if (config.menuEntry) target.menuEntry = config.menuEntry;
        else if (config.toolbox) target.menuEntry = config.toolbox;
        if (config.title) target.title = config.title;
        if (config.type) target.type = config.type;
        if (config.theme) target.theme = config.theme;
        if (typeof config.getContent === 'function') target.getContent = config.getContent;
        if (typeof config.shimActivate === 'function') target.shimActivate = config.shimActivate;
        if (typeof config.onScopeExit === 'function') target.onScopeExit = config.onScopeExit;
    } else {
        dsapRegistryEntries.push(config);
    }
    invalidateDsapHostCache();
}

function dsapResolveAssetUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw)) return raw;
    return raw.startsWith('/') ? raw : `/${raw}`;
}

function loadDsapScriptOnce(src) {
    const url = dsapResolveAssetUrl(src);
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dsap-asset="${src}"]`);
        if (existing) {
            if (existing.dataset.dsapLoaded === '1') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`DSAP script failed: ${src}`)), { once: true });
            return;
        }

        const el = document.createElement('script');
        el.src = url;
        el.dataset.dsapAsset = src;
        el.async = false;
        el.onload = () => {
            el.dataset.dsapLoaded = '1';
            resolve();
        };
        el.onerror = () => reject(new Error(`DSAP script failed: ${src}`));
        document.body.appendChild(el);
    });
}

const DSAP_SMF_THEME_STYLESHEET = 'css/dsap-smf.css';

function ensureDsapSmfThemeStylesheet(entry) {
    const hostEntry = entry || { url: '__dsap-smf-theme__' };
    injectDsapStylesheet(hostEntry, DSAP_SMF_THEME_STYLESHEET);
}

function injectDsapStylesheet(entry, href) {
    const url = dsapResolveAssetUrl(href);
    const marker = `${entry.url}::${href}`;
    let el = document.querySelector(`link[data-dsap-style="${marker}"]`);
    if (!el) {
        el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        el.dataset.dsapStyle = marker;
        el.dataset.dsapEntry = entry.url;
        document.head.appendChild(el);
    }
    if (!entry._assetStyleEls) entry._assetStyleEls = [];
    if (!entry._assetStyleEls.includes(el)) {
        entry._assetStyleEls.push(el);
    }
    return el;
}

async function loadDsapEntryAssets(entry) {
    const live = getDsapRegistryEntry(entry) || entry;
    if (!live || !live.assets) return true;

    if (live._implReady && (typeof live.getContent === 'function' || isDsapShimEntry(live))) {
        return true;
    }

    if (!live._loadPromise) {
        live._loadPromise = (async () => {
            const scripts = Array.isArray(live.assets.scripts) ? live.assets.scripts : [];
            for (const src of scripts) {
                await loadDsapScriptOnce(src);
            }

            const theme = live.theme || (live.assets && live.assets.theme);
            if (theme === 'dsap-smf') {
                ensureDsapSmfThemeStylesheet(live);
            }

            const styles = Array.isArray(live.assets.styles) ? live.assets.styles : [];
            for (const href of styles) {
                injectDsapStylesheet(live, href);
            }

            const current = getDsapRegistryEntry(live) || live;
            current._implReady = true;
        })().catch((e) => {
            const current = getDsapRegistryEntry(live) || live;
            current._loadPromise = null;
            throw e;
        });
    }

    await live._loadPromise;
    return true;
}

function unloadDsapEntryAssets(entry) {
    if (!entry) return;

    if (Array.isArray(entry._assetStyleEls)) {
        entry._assetStyleEls.forEach((el) => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        entry._assetStyleEls = [];
    }

    if (typeof entry.onScopeExit === 'function') {
        try {
            entry.onScopeExit();
        } catch (e) {
            console.warn('DSAP onScopeExit failed:', e);
        }
    }

    if (entry.assets && entry.assets.unloadScripts) {
        const scripts = Array.isArray(entry.assets.scripts) ? entry.assets.scripts : [];
        scripts.forEach((src) => {
            const el = document.querySelector(`script[data-dsap-asset="${src}"]`);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        delete entry.getContent;
        delete entry.shimActivate;
        entry._implReady = false;
        entry._loadPromise = null;
    }
}

function trackDsapEntryShell(entry, shell) {
    if (!entry) return;
    if (!entry._activeShells) entry._activeShells = new Set();
    entry._activeShells.add(shell);
}

function releaseDsapEntryShell(entry, shell) {
    if (!entry || !entry._activeShells) return;
    entry._activeShells.delete(shell);
    if (entry._activeShells.size === 0) {
        unloadDsapEntryAssets(entry);
    }
}

async function ensureDsapEntryReady(entry) {
    if (!entry) return false;

    let live = getDsapRegistryEntry(entry) || entry;
    if (isDsapShimEntry(live) || typeof live.getContent === 'function') {
        return true;
    }
    if (!live.assets) {
        return false;
    }

    try {
        await loadDsapEntryAssets(live);
    } catch (e) {
        console.error('DSAP asset load failed:', live.url, e);
        return false;
    }

    live = getDsapRegistryEntry(entry) || entry;
    return isDsapShimEntry(live) || typeof live.getContent === 'function';
}

async function prepareAndActivateDsapOnShell(shell, url, options = {}) {
    const match = resolveDsap(url);
    if (!match) return false;

    const ready = await ensureDsapEntryReady(match.entry);
    if (!ready) return false;

    return activateDsapOnShell(shell, url, options);
}

function isDsapShimEntry(entry) {
    return entry && (typeof entry.shimActivate === 'function' || typeof entry.activate === 'function');
}

function runDsapShimOnShell(shell, match, options = {}) {
    const { entry } = match;

    deactivateDsapOnShell(shell);

    shell._searchPageMode = false;
    if (shell.searchBody) {
        shell.searchBody.classList.remove('search-page-view');
    }

    // If the registration provides a general activate(shell, match), let it take full control.
    // This is used by core Grimoire domains (search, home, wiki tags, static docs) so the
    // modal can stay a thin router while the domain owns the activation, address, history shape, etc.
    const activator = typeof entry.activate === 'function'
      ? entry.activate
      : (typeof entry.shimActivate === 'function' ? entry.shimActivate : null);

    if (activator) {
      try {
        const handled = activator(shell, match);
        // If the activator returns false/undefined we still do the normal dsap state tracking below
        // so that deactivate / back / etc. continue to work. Many core activators do their own
        // setAddress + addToHistory, which is fine.
      } catch (e) {
        console.error('DSAP activate/shimActivate failed:', e);
      }

      // Core domains often manage their own address/history. Only do the default DSAP bookkeeping
      // when it looks like a classic shim (or when the activator didn't set a _dsapState).
      if (!shell._dsapState) {
        if (typeof shell.setAddress === 'function') {
          shell.setAddress({ displayUrl: match.canonicalUrl, mode: 'dsap' });
        }
        shell._dsapState = { entry, url: match.canonicalUrl, shim: true };
        shell._dsapActive = true;

        if (!options.skipHistory && typeof shell.addToHistory === 'function') {
          shell.addToHistory({
            type: 'dsap',
            url: match.canonicalUrl,
            title: entry.title || match.displayPath
          });
        }
        if (typeof shell.updateNavigationButtons === 'function') {
          shell.updateNavigationButtons();
        }
      }

      trackDsapEntryShell(entry, shell);
      return;
    }

    // Legacy pure shimActivate path (no general activate)
    if (typeof shell.setAddress === 'function') {
        shell.setAddress({ displayUrl: match.canonicalUrl, mode: 'dsap' });
    }

    shell._dsapState = { entry, url: match.canonicalUrl, shim: true };
    shell._dsapActive = true;

    try {
        entry.shimActivate(shell, match);
    } catch (e) {
        console.error('DSAP shimActivate failed:', e);
    }

    if (!options.skipHistory && typeof shell.addToHistory === 'function') {
        shell.addToHistory({
            type: 'dsap',
            url: match.canonicalUrl,
            title: entry.title || match.displayPath
        });
    }

    if (typeof shell.updateNavigationButtons === 'function') {
        shell.updateNavigationButtons();
    }

    trackDsapEntryShell(entry, shell);
}

function teardownDsapDropdownsInRoot(rootEl) {
    if (!rootEl || typeof teardownDropdown !== 'function') return;
    rootEl.querySelectorAll('.custom-dropdown').forEach((el) => teardownDropdown(el));
}

function deactivateDsapOnShell(shell, options = {}) {
    if (!shell || !shell._dsapState) return;

    const state = shell._dsapState;

    // setupDropdown adds document-level listeners — tear down before DOM is replaced.
    const rootEl = state.rootEl || state.host?.getRoot?.();
    teardownDsapDropdownsInRoot(rootEl);

    // customScrollbar: public/scripts/comp/customScrollbar.js — release Map + observers before DOM wipe
    if (rootEl && customScrollbar) {
        rootEl.querySelectorAll('[data-custom-scrollbar], .form-section-scroll').forEach((el) => {
            customScrollbar.destroy(el);
        });
    }

    if (state.host && typeof state.host.clearContextMenuItems === 'function') {
        state.host.clearContextMenuItems();
    }

    if (state.driver && typeof state.driver.destroy === 'function') {
        try {
            state.driver.destroy(state.host);
        } catch (e) {
            console.warn('DSAP destroy failed:', e);
        }
    }

    if (Array.isArray(state.cleanupFns)) {
        state.cleanupFns.forEach((fn) => {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    if (state.styleEl && state.styleEl.parentNode) {
        state.styleEl.parentNode.removeChild(state.styleEl);
    }

    // Reset scroll container bg when leaving DSAP
    const scrollContainer = shell.displayArea ? shell.displayArea.closest('.form-section-scroll') : null;
    if (scrollContainer) {
        scrollContainer.style.backgroundColor = '';
    }

    if (state.entry && !options.keepEntryScope) {
        releaseDsapEntryShell(state.entry, shell);
    }

    shell._dsapState = null;
    shell._dsapActive = false;
    shell.currentStaticWiki = null;
    shell.currentSelectedTag = null;
    shell.currentTagName = null;
}

function createDsapHost(shell, registration, url, rootEl) {
    const match = resolveDsap(url) || { displayPath: normalizeDsapUrlInput(url), canonicalUrl: url };
    const listeners = [];

    const getCurrentUrl = () => shell._dsapState?.url || match.canonicalUrl;

    const host = {
        shell,
        registration,
        url: match.canonicalUrl,
        displayPath: match.displayPath,

        getRoot() {
            return rootEl;
        },

        navigate(pseudoUrl) {
            if (typeof shell.navigate === 'function') {
                shell.navigate(pseudoUrl);
            } else if (typeof tagWikiSearchModal !== 'undefined' && tagWikiSearchModal && tagWikiSearchModal.navigate) {
                tagWikiSearchModal.navigate(pseudoUrl);
            }
        },

        /** Update DSAP URL + address bar without destroy/reinit (same registration only). */
        setUrl(pseudoUrl, options = {}) {
            const newMatch = resolveDsap(pseudoUrl);
            if (!newMatch || newMatch.entry.url !== registration.url) {
                return false;
            }
            const nextUrl = newMatch.canonicalUrl;
            const currentUrl = getCurrentUrl();
            if (currentUrl === nextUrl) {
                return true;
            }
            if (shell._dsapState) {
                shell._dsapState.url = nextUrl;
            }
            host.url = nextUrl;
            host.displayPath = newMatch.displayPath;
            if (typeof shell.setAddress === 'function') {
                shell.setAddress({ displayUrl: nextUrl, mode: 'dsap' });
            }
            if (!options.skipHistory && typeof shell.addToHistory === 'function') {
                shell.addToHistory({
                    type: 'dsap',
                    url: nextUrl,
                    title: registration.title || newMatch.displayPath
                });
            }
            if (typeof shell.updateNavigationButtons === 'function') {
                shell.updateNavigationButtons();
            }
            return true;
        },

        refresh() {
            prepareAndActivateDsapOnShell(shell, getCurrentUrl(), { force: true });
        },

        showToast(kind, title, message, sticky, duration, icon) {
            // showGlassToast: public/scripts/app.js
            if (typeof showGlassToast === 'function') {
                showGlassToast(kind, title, message, sticky, duration, icon);
            }
        },

        getPathSegments() {
            const norm = normalizeDsapUrlInput(getCurrentUrl()).split('?')[0];
            const base = normalizeDsapUrlInput(registration.url);
            const hostPart = base.split('/')[0];
            const pathHost = norm.startsWith(hostPart) ? hostPart : norm.split('/')[0];
            if (!norm.startsWith(pathHost)) return [];
            const rest = norm.slice(pathHost.length).replace(/^\//, '');
            return rest ? rest.split('/').filter(Boolean) : [];
        },

        getQueryParam(name) {
            const norm = normalizeDsapUrlInput(getCurrentUrl());
            const qIdx = norm.indexOf('?');
            if (qIdx < 0) return null;
            try {
                const params = new URLSearchParams(norm.slice(qIdx + 1));
                return params.get(name);
            } catch (e) {
                return null;
            }
        },

        on(eventName, handler) {
            if (!window.wsClient || typeof window.wsClient.on !== 'function') return;
            window.wsClient.on(eventName, handler);
            listeners.push(() => {
                if (window.wsClient && typeof window.wsClient.off === 'function') {
                    window.wsClient.off(eventName, handler);
                }
            });
        },

        getWsClient() {
            return window.wsClient || null;
        },

        /**
         * Register context-menu items for matching elements inside this applet.
         * @param {string|function} match CSS selector or (el, ctx) => boolean
         * @param {Array|function} itemsOrBuilder list items or (el, ctx) => items[]
         * @returns {function} unregister
         */
        registerContextMenuItems(match, itemsOrBuilder) {
            if (!match || itemsOrBuilder == null) return () => {};
            const entry = { match, itemsOrBuilder };
            host._contextMenuRegistrations.push(entry);
            return () => {
                const idx = host._contextMenuRegistrations.indexOf(entry);
                if (idx >= 0) host._contextMenuRegistrations.splice(idx, 1);
            };
        },

        /** Register a handler for declarative / string action ids (e.g. data-dsap-ctx-action). */
        registerContextMenuAction(actionId, handler) {
            const id = String(actionId || '').trim();
            if (!id || typeof handler !== 'function') return () => {};
            host._contextMenuActions.set(id, handler);
            return () => {
                if (host._contextMenuActions.get(id) === handler) {
                    host._contextMenuActions.delete(id);
                }
            };
        },

        clearContextMenuItems() {
            host._contextMenuRegistrations.length = 0;
            host._contextMenuActions.clear();
        }
    };

    host._listeners = listeners;
    host._contextMenuRegistrations = [];
    host._contextMenuActions = new Map();
    return host;
}

/**
 * Collect applet-contributed context menu list items for a click target.
 * Merge order for callers: registered (deepest) → declarative attrs → (caller adds link/image + chrome).
 * @returns {{ items: Array, actionElement: Element|null }}
 */
function collectDsapHostContextMenuItems(host, clickEl) {
    const empty = { items: [], actionElement: null };
    if (!host || !clickEl) return empty;

    const root = typeof host.getRoot === 'function' ? host.getRoot() : null;
    if (!root || !root.contains(clickEl)) return empty;

    const ctx = { host, root, shell: host.shell };
    const items = [];
    let actionElement = null;

    // 1. Registered matchers — prefer deepest matching element
    const regs = host._contextMenuRegistrations || [];
    if (regs.length) {
        const scored = [];
        for (let i = 0; i < regs.length; i++) {
            const reg = regs[i];
            const matchedEl = resolveDsapContextMenuMatch(reg.match, clickEl, root, ctx);
            if (!matchedEl) continue;
            let depth = 0;
            let n = matchedEl;
            while (n && n !== root) {
                depth++;
                n = n.parentElement;
            }
            scored.push({ reg, matchedEl, depth, order: i });
        }
        scored.sort((a, b) => (b.depth - a.depth) || (a.order - b.order));
        for (const row of scored) {
            const built = typeof row.reg.itemsOrBuilder === 'function'
                ? row.reg.itemsOrBuilder(row.matchedEl, ctx)
                : row.reg.itemsOrBuilder;
            if (!Array.isArray(built) || !built.length) continue;
            if (!actionElement) actionElement = row.matchedEl;
            for (const item of built) {
                if (item && typeof item === 'object') {
                    items.push(decorateDsapContextMenuItem(item, row.matchedEl));
                }
            }
        }
    }

    // 2. Declarative attrs on closest annotated ancestor
    const declEl = clickEl.closest('[data-dsap-ctx-action], [data-dsap-ctx-items]');
    if (declEl && root.contains(declEl)) {
        if (!actionElement) actionElement = declEl;
        const declItems = parseDsapDeclarativeContextMenuItems(declEl);
        for (const item of declItems) {
            items.push(decorateDsapContextMenuItem(item, declEl));
        }
    }

    return { items, actionElement };
}

function resolveDsapContextMenuMatch(match, clickEl, root, ctx) {
    if (typeof match === 'function') {
        let el = clickEl;
        while (el && el !== root.parentElement) {
            if (match(el, ctx)) return el;
            if (el === root) break;
            el = el.parentElement;
        }
        return null;
    }
    const selector = String(match || '').trim();
    if (!selector) return null;
    try {
        const found = clickEl.closest(selector);
        if (found && root.contains(found)) return found;
        return null;
    } catch (e) {
        return null;
    }
}

function decorateDsapContextMenuItem(item, el) {
    const out = Object.assign({}, item);
    out._dsapCtxElement = el;
    if (out.action && typeof out.action === 'string' && !out.action.startsWith('dsap-ctx:')) {
        // Keep raw action id for host.registerContextMenuAction; shell prefixes routing.
        out._dsapCtxActionId = out.action;
        out.action = `dsap-ctx:${out.action}`;
    } else if (typeof out.handler === 'function' && !out.action) {
        out.action = 'dsap-ctx:handler';
        out._dsapCtxHandler = out.handler;
    }
    return out;
}

function parseDsapDeclarativeContextMenuItems(el) {
    const items = [];
    const itemsJson = el.getAttribute('data-dsap-ctx-items');
    if (itemsJson) {
        try {
            const parsed = JSON.parse(itemsJson);
            if (Array.isArray(parsed)) {
                for (const raw of parsed) {
                    if (!raw || typeof raw !== 'object') continue;
                    items.push(buildDsapDeclarativeItem(el, raw.action, raw.text || raw.label, raw.icon, raw));
                }
            }
        } catch (e) {
            console.warn('DSAP data-dsap-ctx-items JSON parse failed:', e);
        }
    }

    const action = el.getAttribute('data-dsap-ctx-action');
    if (action) {
        items.push(buildDsapDeclarativeItem(
            el,
            action,
            el.getAttribute('data-dsap-ctx-label') || action,
            el.getAttribute('data-dsap-ctx-icon') || 'fas fa-ellipsis-h',
            null
        ));
    }

    return items.filter(Boolean);
}

function buildDsapDeclarativeItem(el, action, label, icon, rawExtra) {
    const actionId = String(action || '').trim();
    if (!actionId) return null;
    const data = {};
    if (el && el.attributes) {
        for (const attr of el.attributes) {
            if (!attr.name.startsWith('data-dsap-ctx-')) continue;
            if (attr.name === 'data-dsap-ctx-action' || attr.name === 'data-dsap-ctx-label'
                || attr.name === 'data-dsap-ctx-icon' || attr.name === 'data-dsap-ctx-items') {
                continue;
            }
            const key = attr.name.slice('data-dsap-ctx-'.length).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            data[key] = attr.value;
        }
    }
    if (rawExtra && typeof rawExtra === 'object') {
        Object.keys(rawExtra).forEach((k) => {
            if (k === 'action' || k === 'text' || k === 'label' || k === 'icon') return;
            data[k] = rawExtra[k];
        });
    }
    return {
        text: String(label || actionId),
        icon: icon || 'fas fa-ellipsis-h',
        action: actionId,
        data,
        disabled: !!(rawExtra && rawExtra.disabled)
    };
}

/** Dispatch a dsap-ctx:* menu action through the host action map / item handler. */
function dispatchDsapContextMenuAction(host, action, item, clickEl) {
    if (!host || !action) return false;
    const el = (item && item._dsapCtxElement) || clickEl || null;

    if (item && typeof item._dsapCtxHandler === 'function') {
        try {
            item._dsapCtxHandler(el, item, { host, shell: host.shell });
        } catch (e) {
            console.error('DSAP context menu handler failed:', e);
        }
        return true;
    }

    let actionId = item && item._dsapCtxActionId;
    if (!actionId && String(action).startsWith('dsap-ctx:')) {
        actionId = String(action).slice('dsap-ctx:'.length);
    }
    if (!actionId) return false;

    const handler = host._contextMenuActions && host._contextMenuActions.get(actionId);
    if (typeof handler !== 'function') {
        console.warn('DSAP context menu action not registered:', actionId);
        return true;
    }
    try {
        handler(el, item, { host, shell: host.shell });
    } catch (e) {
        console.error('DSAP context menu action failed:', actionId, e);
    }
    return true;
}

function activateDsapOnShell(shell, url, options = {}) {
    if (!shell || !shell.displayArea) return false;

    const match = resolveDsap(url);
    if (!match) return false;

    const { entry } = match;
    if (!options.force && shell._dsapActive && shell._dsapState?.url === match.canonicalUrl) {
        if (shell._dsapState.driver && typeof shell._dsapState.driver.refresh === 'function') {
            shell._dsapState.driver.refresh(shell._dsapState.host);
        }
        return true;
    }

    const keepEntryScope = shell._dsapState?.entry?.url === entry.url;
    deactivateDsapOnShell(shell, { keepEntryScope: keepEntryScope });

    let content;
    try {
        content = typeof entry.getContent === 'function' ? entry.getContent(match) : null;
    } catch (e) {
        console.error('DSAP getContent failed:', e);
        return false;
    }
    if (!content || !content.html) {
        console.warn('DSAP missing html content:', entry.url);
        return false;
    }

    shell._searchPageMode = false;
    if (shell.searchBody) {
        shell.searchBody.classList.remove('search-page-view');
    }

    shell.displayArea.innerHTML = content.html;
    const rootEl = shell.displayArea.querySelector('[data-dsap]') || shell.displayArea.firstElementChild;

    let styleEl = null;
    if (content.css) {
        styleEl = document.createElement('style');
        styleEl.dataset.dsapStyle = String(++dsapStyleCounter);
        styleEl.textContent = content.css;
        shell.displayArea.appendChild(styleEl);
    }

    // Apply per-DSAP base background color to the scroll container
    if (content.baseBackground) {
        const scrollContainer = shell.displayArea.closest('.form-section-scroll');
        if (scrollContainer) {
            scrollContainer.style.backgroundColor = content.baseBackground;
        }
    }

    const host = createDsapHost(shell, entry, match.canonicalUrl, rootEl);
    const driver = content.drivers || {};
    const cleanupFns = [...(host._listeners || [])];

    shell._dsapState = {
        entry,
        url: match.canonicalUrl,
        host,
        driver,
        styleEl,
        rootEl,
        cleanupFns
    };
    shell._dsapActive = true;
    shell.currentStaticWiki = null;
    shell.currentSelectedTag = null;
    shell.currentTagName = null;

    if (typeof driver.init === 'function') {
        try {
            driver.init(host);
        } catch (e) {
            console.error('DSAP init failed:', e);
        }
    }

    trackDsapEntryShell(entry, shell);

    if (typeof shell.setAddress === 'function') {
        shell.setAddress({ displayUrl: match.canonicalUrl, mode: 'dsap' });
    }

    if (typeof shell._interceptAllLinks === 'function') {
        shell._interceptAllLinks();
    }

    if (window.customScrollbar && shell.displayArea) {
        const scrollContainer = shell.displayArea.closest('.form-section-scroll');
        if (scrollContainer && typeof window.customScrollbar.updateScrollbar === 'function') {
            window.customScrollbar.updateScrollbar(scrollContainer);
        }
    }

    return true;
}

function navigateDsapIfMatched(shell, url, options = {}) {
    const match = resolveDsap(url);
    if (!match) return false;

    const { entry } = match;
    const isShim = isDsapShimEntry(entry);

    const runActivation = async () => {
        const ready = await ensureDsapEntryReady(entry);
        if (!ready) {
            if (typeof shell.showGrimoireNavigateErrorPage === 'function') {
                shell.showGrimoireNavigateErrorPage({
                    url: match.canonicalUrl,
                    kind: 'not_found',
                    skipHistory: true,
                    skipLoadingDelay: true
                });
            }
            return;
        }

        if (isShim) {
            runDsapShimOnShell(shell, match, options);
            return;
        }

        const activated = await prepareAndActivateDsapOnShell(shell, url, options);
        if (!activated) {
            if (typeof shell.showGrimoireNavigateErrorPage === 'function') {
                shell.showGrimoireNavigateErrorPage({
                    url: match.canonicalUrl,
                    kind: 'not_found',
                    skipHistory: true,
                    skipLoadingDelay: true
                });
            }
            return;
        }

        if (!options.skipHistory && typeof shell.addToHistory === 'function') {
            shell.addToHistory({
                type: 'dsap',
                url: match.canonicalUrl,
                title: entry.title || match.displayPath
            });
        }
        if (typeof shell.updateNavigationButtons === 'function') {
            shell.updateNavigationButtons();
        }
    };

    if (options.skipLoadingDelay) {
        runActivation();
        return true;
    }

    const navStart = options.navStartedAt || Date.now();
    const displayPath = match.displayPath || url;

    if (!isShim && typeof shell.showGrimoireNavigationLoadingPage === 'function') {
        shell.showGrimoireNavigationLoadingPage(displayPath);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            runActivation().finally(() => {
                const wait = isShim ? 0 : grimoireGetNavLoadingDelayMs(navStart);
                if (typeof shell.setNavigationLoading === 'function') {
                    setTimeout(() => shell.setNavigationLoading(false), wait);
                }
            });
        });
    });

    return true;
}

async function openDsapInGrimoire(url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) {
        console.warn('openDsapInGrimoire: missing url');
        return;
    }

    // public/scripts/comp/featureLoader.js — TagWikiSearchModal / wikiWindowManager
    await featureLoader.loadFeature('grimoire');

    if (options.standalone) {
        await openDsapInStandaloneWindow(targetUrl, options);
        return;
    }

    const modal = tagWikiSearchModal;
    if (!modal) return;

    const runNav = () => {
        if (modal.navigate) {
            modal.navigate(targetUrl);
        } else {
            prepareAndActivateDsapOnShell(modal, targetUrl);
        }
    };

    if (modal.modal && modal.modal.classList.contains('hidden')) {
        modal.open('', { skipInitialHome: true, initialAddress: targetUrl });
        setTimeout(runNav, 50);
    } else {
        runNav();
    }
}

async function openDsapInStandaloneWindow(url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) return;

    // public/scripts/comp/featureLoader.js
    await featureLoader.loadFeature('grimoire');

    const match = resolveDsap(targetUrl);
    if (!match) {
        await openDsapInGrimoire(targetUrl);
        return;
    }

    // wikiWindowManager.createDsapWindow: public/scripts/comp/tagWikiSearchModal.js
    if (typeof wikiWindowManager !== 'undefined' && wikiWindowManager && wikiWindowManager.createDsapWindow) {
        wikiWindowManager.createDsapWindow(targetUrl, options.historyToCopy || null);
        return;
    }

    await openDsapInGrimoire(targetUrl);
}
