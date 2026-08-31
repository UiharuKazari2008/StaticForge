/**
 * MCP activity tray (2 min) + Spectator log + open Lumen / Glancewell from MCP.
 * Depends on: wsInboundRegistry, trayIndicators, lightbox, imageViewer, fatalErrorBootstrap
 */

(function initMcpActivityClient() {
    const MCP_ACTIVITY_TTL_MS = 2 * 60 * 1000;
    const log = [];
    let hideTimer = null;

    function formatTime(at) {
        try {
            return new Date(at).toLocaleTimeString();
        } catch (_err) {
            return '';
        }
    }

    function summarizeHover(entry) {
        if (!entry) return 'MCP';
        const tool = entry.tool || 'mcp';
        const result = entry.result || {};
        const bit = result.filename || (Array.isArray(result.filenames) ? result.filenames[0] : '') || result.error || '';
        return bit ? `MCP: ${tool} — ${bit}` : `MCP: ${tool}`;
    }

    function updateMcpActivityIndicator() {
        const indicator = document.getElementById('mcpActivityIndicator');
        if (!indicator) return;
        const now = Date.now();
        const recent = log.filter((row) => now - row.at <= MCP_ACTIVITY_TTL_MS);
        const last = recent[recent.length - 1];
        if (!last) {
            indicator.classList.add('hidden');
            indicator.classList.remove('active');
            indicator.title = 'MCP';
            return;
        }
        indicator.classList.remove('hidden');
        indicator.classList.add('active');
        indicator.title = summarizeHover(last);
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(updateMcpActivityIndicator, Math.max(250, MCP_ACTIVITY_TTL_MS - (now - last.at) + 50));
    }

    function renderMcpSpectatorList() {
        const listEl = document.getElementById('dreamscapeMcpActivityList');
        if (!listEl) return;
        if (!log.length) {
            listEl.innerHTML = (
                '<div class="dreamscape-app-error-empty">' +
                '<i class="fas fa-plug"></i>' +
                '<p>No MCP interactions recorded.</p>' +
                '</div>'
            );
            return;
        }
        let html = '';
        for (let i = log.length - 1; i >= 0; i--) {
            const entry = log[i];
            const result = entry.result || {};
            const argsText = JSON.stringify(entry.args || {});
            const resultText = JSON.stringify(result);
            html += (
                '<button type="button" class="dreamscape-app-error-card" data-mcp-index="' + i + '">' +
                '<div class="dreamscape-app-error-card-icon"><i class="fas fa-plug"></i></div>' +
                '<div class="dreamscape-app-error-card-body">' +
                '<div class="dreamscape-app-error-card-title">' + escapeHtml('MCP: ' + (entry.tool || 'call')) + '</div>' +
                '<div class="dreamscape-app-error-card-meta">' + escapeHtml(argsText) + '</div>' +
                '<div class="dreamscape-app-error-card-meta">' + escapeHtml(resultText) + '</div>' +
                '<div class="dreamscape-app-error-card-time">' + escapeHtml(formatTime(entry.at)) + '</div>' +
                '</div>' +
                '</button>'
            );
        }
        listEl.innerHTML = html;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function recordMcpActivity(data) {
        if (!data || typeof data !== 'object') return;
        const entry = {
            tool: data.tool || '',
            args: data.args || {},
            result: data.result || null,
            success: data.success !== false,
            generating: data.generating,
            at: Number(data.at) || Date.now()
        };
        log.push(entry);
        if (log.length > 80) log.splice(0, log.length - 80);

        if (entry.generating === true) {
            window.mcpRemoteGenerating = true;
        } else if (entry.generating === false) {
            window.mcpRemoteGenerating = false;
        }
        // updateImageGenerationIndicator: public/scripts/comp/trayIndicators.js
        if (typeof updateImageGenerationIndicator === 'function') {
            updateImageGenerationIndicator({ reveal: true });
        }
        updateMcpActivityIndicator();
        renderMcpSpectatorList();
    }

    function resolveViewerImage(filename) {
        // findImageByFilename: public/scripts/comp/galleryView.js
        const found = typeof findImageByFilename === 'function' ? findImageByFilename(filename) : null;
        return found || { filename: filename, original: filename };
    }

    function openLumenForFilenames(filenames) {
        const name = filenames[0];
        if (!name) return { ok: false, error: 'filename is required' };
        const image = resolveViewerImage(name);
        if (typeof window.openGalleryImageInViewer !== 'function') {
            return { ok: false, error: 'Lumen is not available' };
        }
        window.openGalleryImageInViewer(image);
        return { ok: true, target: 'lumen', filename: name };
    }

    async function openGlancewellForFilenames(filenames) {
        if (!filenames.length) return { ok: false, error: 'filename is required' };
        if (filenames.length === 1 && typeof showLightbox === 'function') {
            await showLightbox({ filename: filenames[0] });
            return { ok: true, target: 'glancewell', filenames: filenames };
        }
        const dataSource = filenames.map((name) => {
            const image = resolveViewerImage(name);
            // resolveGalleryFullImageUrl / localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            const src = (typeof resolveGalleryFullImageUrl === 'function' && resolveGalleryFullImageUrl(image))
                || (typeof localGalleryImageUrl === 'function' && localGalleryImageUrl(image.upscaled || image.original || name))
                || ('/images/' + encodeURIComponent(name));
            return {
                src: src,
                width: image.width || 1024,
                height: image.height || 1024
            };
        });
        if (typeof openStandalonePhotoSwipe !== 'function') {
            return { ok: false, error: 'Glancewell is not available' };
        }
        await openStandalonePhotoSwipe(dataSource);
        return { ok: true, target: 'glancewell', filenames: filenames };
    }

    async function openMcpViewer(data) {
        const target = String((data && data.target) || 'lumen').toLowerCase();
        const filenames = [];
        const raw = (data && (data.filenames || data.filename)) || [];
        const list = Array.isArray(raw) ? raw : [raw];
        list.forEach((item) => {
            const name = typeof item === 'string' ? item : (item && item.filename);
            if (name) filenames.push(name);
        });
        if (target === 'glancewell' || target === 'lightbox') {
            return openGlancewellForFilenames(filenames);
        }
        return openLumenForFilenames(filenames);
    }

    if (typeof registerWsInboundHandler === 'function') {
        registerWsInboundHandler({
            id: 'mcp.activity',
            type: 'mcp_activity',
            phase: 'only',
            handler(message) {
                recordMcpActivity(message && message.data);
            }
        });
        registerWsInboundHandler({
            id: 'mcp.open_viewer',
            type: 'mcp_open_viewer',
            phase: 'only',
            handler(message) {
                void openMcpViewer(message && message.data);
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.openMcpViewer = openMcpViewer;
        window.renderMcpSpectatorList = renderMcpSpectatorList;
        window.recordMcpActivity = recordMcpActivity;
    }

    document.addEventListener('click', function (ev) {
        const btn = ev.target && ev.target.closest && ev.target.closest('[data-fatal-toolbar="clear"]');
        if (!btn) return;
        log.length = 0;
        renderMcpSpectatorList();
        updateMcpActivityIndicator();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            updateMcpActivityIndicator();
            renderMcpSpectatorList();
        });
    } else {
        updateMcpActivityIndicator();
        renderMcpSpectatorList();
    }
})();
