/**
 * StaticForge automation bridge for ResourcesSaverExt (Save All Resources).
 *
 * Listens for page postMessage:
 *   { type: 'RESOURCES_SAVER_AUTOMATION_SAVE', requestId }
 * Responds with:
 *   { type: 'RESOURCES_SAVER_AUTOMATION_SAVE_RESULT', requestId, response: { ok, ... } }
 *
 * This runs without the DevTools panel. It re-fetches resources discovered via
 * Performance Resource Timing + DOM script/link tags, packs a store-method ZIP,
 * and triggers a browser download (saved via CDP Browser.setDownloadBehavior).
 *
 * Upstream extension: https://github.com/up209d/ResourcesSaverExt (GPL-3.0+)
 * Pin: see scripts/nai-webapp-watch/extension-automation/SOURCE.txt
 */
(function () {
  'use strict';

  if (window.__naiResourcesSaverAutomationBridge) return;
  window.__naiResourcesSaverAutomationBridge = true;

  const MSG_SAVE = 'RESOURCES_SAVER_AUTOMATION_SAVE';
  const MSG_RESULT = 'RESOURCES_SAVER_AUTOMATION_SAVE_RESULT';

  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }

  function u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
  }

  function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  }

  function concat(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function encodePath(path) {
    return new TextEncoder().encode(path.replace(/^\/+/, ''));
  }

  /** Minimal store-method ZIP (no compression). */
  function buildZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encodePath(file.path);
      const data = file.data;
      const crc = crc32(data);
      const localHeader = concat([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes
      ]);
      localParts.push(localHeader, data);

      const central = concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ]);
      centralParts.push(central);
      offset += localHeader.length + data.length;
    }

    const centralDir = concat(centralParts);
    const end = concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centralDir.length),
      u32(offset),
      u16(0)
    ]);
    return concat([...localParts, centralDir, end]);
  }

  function urlToPath(rawUrl, pageOrigin) {
    try {
      const u = new URL(rawUrl, pageOrigin);
      let pathname = u.pathname || '/';
      if (pathname.endsWith('/')) pathname += 'index.html';
      if (pathname === '') pathname = '/index.html';
      // Keep host prefix so multi-origin assets don't collide.
      const host = u.hostname.replace(/([^A-Za-z0-9.])/g, '_');
      const qs = u.search ? '_' + u.search.slice(1).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) : '';
      const base = host + pathname + qs;
      return base.replace(/^\/+/, '');
    } catch (_) {
      return 'unknown/' + String(rawUrl).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
    }
  }

  function collectUrls() {
    const urls = new Set();
    urls.add(location.href);
    try {
      for (const entry of performance.getEntriesByType('resource') || []) {
        if (entry && entry.name) urls.add(entry.name);
      }
    } catch (_) {}
    document.querySelectorAll('script[src], link[href], img[src], source[src]').forEach((el) => {
      const v = el.getAttribute('src') || el.getAttribute('href');
      if (!v) return;
      try {
        urls.add(new URL(v, location.href).href);
      } catch (_) {}
    });
    // Prefer http(s) only; skip chrome-extension, data:, blob:
    return [...urls].filter((u) => /^https?:\/\//i.test(u));
  }

  async function fetchOne(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf;
  }

  function triggerDownload(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }

  async function runSave(requestId) {
    const started = Date.now();
    const urls = collectUrls();
    const files = [];
    const errors = [];
    const seenPaths = new Set();

    // Cap to keep dumps bounded for contract review (chunks + page assets).
    const MAX = 400;
    const slice = urls.slice(0, MAX);

    for (const url of slice) {
      let path = urlToPath(url, location.origin);
      if (seenPaths.has(path)) {
        const i = path.lastIndexOf('.');
        path = i > 0 ? path.slice(0, i) + '_' + seenPaths.size + path.slice(i) : path + '_' + seenPaths.size;
      }
      seenPaths.add(path);
      try {
        const data = await fetchOne(url);
        files.push({ path, data, url });
      } catch (err) {
        errors.push({ url, error: String(err && err.message ? err.message : err) });
      }
    }

    if (!files.length) {
      return {
        ok: false,
        error: 'no resources fetched',
        attempted: slice.length,
        errors: errors.slice(0, 20)
      };
    }

    const zipBytes = buildZip(files);
    const host = location.hostname.replace(/([^A-Za-z0-9.])/g, '_') || 'dump';
    const filename = host + '.zip';
    triggerDownload(zipBytes, filename);

    return {
      ok: true,
      mode: 'automation-bridge',
      filename,
      fileCount: files.length,
      errorCount: errors.length,
      attempted: slice.length,
      truncated: urls.length > MAX,
      elapsedMs: Date.now() - started,
      note: 'Automation bridge re-fetches resources (no DevTools panel). Good enough for public chunk contract diffs.'
    };
  }

  function reply(requestId, response) {
    window.postMessage({ type: MSG_RESULT, requestId, response }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== MSG_SAVE) return;
    const requestId = data.requestId;
    runSave(requestId)
      .then((response) => reply(requestId, response))
      .catch((err) =>
        reply(requestId, { ok: false, error: String(err && err.message ? err.message : err) })
      );
  });
})();
