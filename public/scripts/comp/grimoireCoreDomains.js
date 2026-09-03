/**
 * Grimoire Core Domain Registrations
 *
 * This file registers the built-in "pseudo-sites" that power the Grimoire browser
 * (en.grimoire.jp, wiki.danbooru.jp, docs.novelai.jp, etc.) using the same
 * domain + alias resolution mechanism as DSAP applets.
 *
 * Goal: the "browser" (tagWikiSearchModal + panes) should be a thin router + chrome.
 * All routing decisions and page activation live in registered domain handlers.
 *
 * Each registration uses the existing DSAP/Grimoire domain system (registerDsap).
 * For core surfaces that still rely on rich methods on the shell (search state,
 * wiki body rendering, history shapes, etc.), we use shimActivate or a lightweight
 * activate hook that parses the match and calls the appropriate shell method.
 *
 * New domains / applets should live in their own file (like quipsDsapApplet.js)
 * and call registerDsap at load time.
 *
 * See: public/scripts/comp/dsapRegistry.js (resolveDsap, navigateDsapIfMatched, createDsapHost, etc.)
 */

(function registerGrimoireCoreDomains() {
  if (typeof registerDsap !== 'function') {
    // Too early or not in Grimoire context — will be retried or not needed
    return;
  }

  // --- 1. Main Grimoire Encyclopedia: en.grimoire.jp ---
  // Covers: home, index, search (with ?q=), bare host, and the generic "docs" convenience.
  registerDsap({
    url: 'en.grimoire.jp',
    aliases: [
      'en.grimoire.jp/index',
      'en.grimoire.jp/home',
      'en.grimoire.jp/index.dtxt',
      'en.grimoire.jp/search',
      'grimoire.jp',
      // legacy / convenience
      'en.grimoire.jp/docs'
    ],
    title: 'Grimoire',
    type: 'core',
    // We use a custom activate so the shell (which owns search state, filters, history shapes, etc.)
    // can be driven without duplicating all the rendering code here yet.
    // The registry match gives us structured info; the activate receives the live shell.
    activate(shell, match) {
      if (!shell || !shell.displayArea) return false;

      const norm = (typeof normalizeDsapUrlInput === 'function')
        ? normalizeDsapUrlInput(match.canonicalUrl || match.displayPath || '')
        : String(match.displayPath || match.canonicalUrl || '').toLowerCase();

      const urlForQuery = match.canonicalUrl || '';

      // Search page (including the bare search "homepage" form when no q)
      if (norm.includes('/search') || norm.endsWith('search')) {
        let q = '';
        try {
          // Prefer the original url if it had query, otherwise parse from canonical
          const src = urlForQuery || match.canonicalUrl || '';
          const qMatch = src.match(/[?&]q=([^?&#]+)/i);
          q = qMatch ? decodeURIComponent(qMatch[1]) : '';
        } catch (e) {}

        if (shell.searchInput && q) shell.searchInput.value = q;

        // Record proper history entry (search type) so back/forward works
        if (typeof shell.addToHistory === 'function') {
          shell.addToHistory({
            type: 'search',
            query: q || '',
            filter: shell.currentFilter || '',
            searchType: shell.currentSearchType || 'name',
            source: shell.currentSource || 'both',
            includeOnline: !!shell.includeOnline,
            results: []
          });
        }

        shell._searchPageMode = true;
        if (typeof shell.showSearchResultsPage === 'function') {
          shell.showSearchResultsPage(q, true);
        }

        // Perform search; the _searchPageMode guard prevents sidebar pollution
        if (typeof shell.performSearch === 'function') {
          shell.performSearch().finally(() => {
            shell._searchPageMode = false;
            if (typeof shell.setNavigationLoading === 'function') shell.setNavigationLoading(false);
            if (typeof shell.showSearchResultsPage === 'function') shell.showSearchResultsPage(q, false);
          });
        } else {
          shell._searchPageMode = false;
          if (typeof shell.setNavigationLoading === 'function') shell.setNavigationLoading(false);
        }

        const display = q
          ? `edtx://en.grimoire.jp/search?q=${encodeURIComponent(q)}`
          : 'edtx://en.grimoire.jp/search';
        if (typeof shell.setAddress === 'function') {
          shell.setAddress({ displayUrl: display, mode: 'edtx' });
        }
        return true;
      }

      // Home / index
      if (norm.includes('/index') || norm.includes('/home') || norm === 'en.grimoire.jp' || norm === 'grimoire.jp') {
        if (typeof shell.setAddress === 'function') {
          shell.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
        }
        if (typeof shell.showDreamWikiHomepage === 'function') {
          shell.showDreamWikiHomepage();
        }
        if (typeof shell.setNavigationLoading === 'function') shell.setNavigationLoading(false);
        return true;
      }

      // Cached static / MediaWiki viewer: en.grimoire.jp/docs/<siteId>[/<pageId>]
      const docsSrc = String(match.canonicalUrl || match.displayPath || urlForQuery || '');
      const docsMatch = docsSrc.replace(/^(edtx|rdf|dsap):\/\//i, '').match(/en\.grimoire\.jp\/docs\/([^/?#]+)(?:\/([^?#]+))?/i);
      if (docsMatch) {
        let siteId = docsMatch[1];
        let pageId = docsMatch[2] ? String(docsMatch[2]).replace(/\/+$/, '') : '';
        try { siteId = decodeURIComponent(siteId); } catch (e) {}
        if (pageId) {
          try { pageId = decodeURIComponent(pageId); } catch (e) {}
        }
        if (pageId && typeof shell.openStaticWikiPage === 'function') {
          shell.openStaticWikiPage(siteId, pageId);
          return true;
        }
        if (typeof shell.showStaticWikiSiteIndex === 'function') {
          shell.showStaticWikiSiteIndex(siteId);
          return true;
        }
      }

      // Fallback for en.grimoire.jp/* → treat as home for now (future: tag landing etc.)
      if (typeof shell.setAddress === 'function') {
        shell.setAddress({ displayUrl: 'edtx://en.grimoire.jp/index.dtxt', mode: 'edtx' });
      }
      if (typeof shell.showDreamWikiHomepage === 'function') {
        shell.showDreamWikiHomepage();
      }
      if (typeof shell.setNavigationLoading === 'function') shell.setNavigationLoading(false);
      return true;
    }
  });

  // --- 2. External wiki sources (danbooru / e621) as first-class domains ---
  // These resolve to a tag wiki page fetch.
  registerDsap({
    url: 'wiki.danbooru.jp',
    aliases: ['wiki.danbooru.jp/tag', 'danbooru.jp/tag'],
    title: 'Danbooru Wiki',
    type: 'core',
    activate(shell, match) {
      const norm = (typeof normalizeDsapUrlInput === 'function')
        ? normalizeDsapUrlInput(match.canonicalUrl || match.displayPath || '')
        : String(match.displayPath || match.canonicalUrl || '');

      let tag = '';
      const m = norm.match(/\/tag\/([^/?#]+)/i) || String(match.canonicalUrl || '').match(/\/tag\/([^/?#]+)/i);
      if (m && m[1]) {
        tag = decodeURIComponent(m[1]).replace(/_/g, ' ');
      }
      if (tag && typeof shell.getTagWikiPageDirectly === 'function') {
        shell.getTagWikiPageDirectly(tag);
        return true;
      }
      // If we got here without a tag, fall back to search on the shell
      if (typeof shell.performSearch === 'function') {
        if (shell.searchInput) shell.searchInput.value = tag || '';
        shell.performSearch();
      }
      return true;
    }
  });

  registerDsap({
    url: 'wiki.e621.com',
    aliases: ['wiki.e621.com/tag', 'e621.com/tag'],
    title: 'e621 Wiki',
    type: 'core',
    activate(shell, match) {
      const norm = (typeof normalizeDsapUrlInput === 'function')
        ? normalizeDsapUrlInput(match.canonicalUrl || match.displayPath || '')
        : String(match.displayPath || match.canonicalUrl || '');

      let tag = '';
      const m = norm.match(/\/tag\/([^/?#]+)/i) || String(match.canonicalUrl || '').match(/\/tag\/([^/?#]+)/i);
      if (m && m[1]) {
        tag = decodeURIComponent(m[1]).replace(/_/g, ' ');
      }
      if (tag && typeof shell.getTagWikiPageDirectly === 'function') {
        shell.getTagWikiPageDirectly(tag);
        return true;
      }
      if (typeof shell.performSearch === 'function') {
        if (shell.searchInput) shell.searchInput.value = tag || '';
        shell.performSearch();
      }
      return true;
    }
  });

  // --- 2b. Fandom offline wikis ---
  registerDsap({
    url: 'wiki.fandom.jp',
    aliases: [
      'rdf://wiki.fandom.jp',
      'fandom.grimoire.jp',
      'en.grimoire.jp/fandom'
    ],
    title: 'Fandom Wikis',
    type: 'core',
    activate(shell, match) {
      if (!shell) return false;
      const raw = String(match.canonicalUrl || match.displayPath || '');
      const stripped = raw.replace(/^(edtx|rdf|dsap):\/\//i, '');
      const pathPart = stripped.replace(/^wiki\.fandom\.jp\/?/i, '').replace(/^fandom\.grimoire\.jp\/?/i, '').replace(/^en\.grimoire\.jp\/fandom\/?/i, '');
      const [pathNoQuery, query = ''] = pathPart.split('?');
      const showAll = /(?:^|&)all=1(?:&|$)/.test(query);
      const segments = pathNoQuery.split('/').filter(Boolean);
      if (segments.length >= 2 && typeof shell.openStaticWikiPage === 'function') {
        const siteId = decodeURIComponent(segments[0]);
        const pageId = segments.slice(1).map((s) => {
          try { return decodeURIComponent(s); } catch (e) { return s; }
        }).join('/');
        shell.openStaticWikiPage(siteId, pageId, { liveFetch: true });
        if (typeof shell.setAddress === 'function') {
          shell.setAddress({ displayUrl: `rdf://wiki.fandom.jp/${siteId}/${pageId}`, mode: 'rdf' });
        }
        return true;
      }
      if (typeof shell.showFandomWikiIndex === 'function') {
        shell.showFandomWikiIndex({ showAll, siteId: segments[0] || null });
      }
      return true;
    }
  });

  // --- 3. Static / offline documentation (NovelAI docs etc.) ---
  // Uses the rdf:// visual protocol but is registered under the docs host.
  registerDsap({
    url: 'docs.novelai.jp',
    aliases: [
      'docs.novelai.jp/',
      'novelai.jp/docs',
      'rdf://docs.novelai.jp',
      'docs.novelai.net',
      'journal.novelai.net',
      'blog.novelai.net',
      'novelai.medium.com'
    ],
    title: 'NovelAI Documentation',
    type: 'core',
    activate(shell, match) {
      if (!shell) return false;

      let rest = String(match.canonicalUrl || match.displayPath || '')
        .replace(/^(edtx|rdf):\/\//i, '')
        .replace(/^journal\.novelai\.net\/?/i, 'journal/')
        .replace(/^(?:blog\.novelai\.net|novelai\.medium\.com)\/?/i, 'blog/')
        .replace(/^docs\.novelai\.net\/?/i, '')
        .replace(/^docs\.novelai\.jp\/?/i, '')
        .replace(/.*novelai[^/]*\/docs\/?/i, '');

      const siteId = 'novelai';
      const pageId = rest || '';

      if (pageId && typeof shell.openStaticWikiPage === 'function') {
        shell.openStaticWikiPage(siteId, pageId);
      } else if (typeof shell.showStaticWikiSiteIndex === 'function') {
        shell.showStaticWikiSiteIndex(siteId);
      }

      const display = pageId
        ? `rdf://docs.novelai.jp/${pageId}`
        : 'rdf://docs.novelai.jp/';
      if (typeof shell.setAddress === 'function') {
        shell.setAddress({ displayUrl: display, mode: 'rdf' });
      }
      return true;
    }
  });

  // --- 4. Generic "not found" / unknown grimoire-style host handler ---
  // This is intentionally registered last so more specific aliases win.
  // The real error page is still rendered by the shell (showGrimoireNavigateErrorPage).
  registerDsap({
    url: 'grimoire-error.invalid',
    aliases: [],
    title: 'Unknown Domain',
    type: 'core',
    activate(shell, match) {
      if (!shell) return false;
      const url = match.canonicalUrl || match.displayPath || 'unknown';
      if (typeof shell.showGrimoireNavigateErrorPage === 'function') {
        shell.showGrimoireNavigateErrorPage({
          url,
          kind: 'not_found',
          skipHistory: true,
          skipLoadingDelay: true
        });
      }
      return true;
    }
  });

  // --- 5. Apocrypha Issue Views ---
  registerDsap({
    url: 'apocrypha.737.jp.net',
    aliases: ['dsap://apocrypha.737.jp.net'],
    title: 'Apocrypha',
    type: 'core',
    async activate(shell, match) {
      if (!shell || !shell.displayArea) return false;
      shell._searchPageMode = false;
      if (shell.searchBody) {
        shell.searchBody.classList.remove('search-page-view');
      }
      try {
        // modules/apocryphaSite.js: /grim/zine/apocrypha
        let response = await fetch('/grim/zine/apocrypha', { credentials: 'include' });
        if (!response.ok) {
          response = await fetch('https://apocrypha.737.jp.net/', { credentials: 'include' });
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const mainContent = doc.querySelector('main') || doc.querySelector('.zine') || doc.body;
        if (mainContent) {
          shell.displayArea.innerHTML = '';
          shell.displayArea.appendChild(mainContent.cloneNode(true));
        } else {
          shell.displayArea.innerHTML = '<div style="padding: 2rem;">Error: Could not find main content.</div>';
        }
      } catch (e) {
        console.error('[Apocrypha] Error fetching view:', e);
        shell.displayArea.innerHTML = '<div style="padding: 2rem;">Error loading Apocrypha.</div>';
      }
      return true;
    }
  });

  // Optional: expose a tiny helper so other code can ask "is this one of the core encyclopedia surfaces?"
  if (typeof window !== 'undefined') {
    window.__grimoireCoreDomainsRegistered = true;
  }
})();
