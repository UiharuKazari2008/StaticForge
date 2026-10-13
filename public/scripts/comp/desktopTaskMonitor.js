/**
 * Vista task monitor for pointers. A busy window gets wait (--c-wait) while
 * hovered. Other work remints the arrow to Working in Background (--c-progress).
 * Desktop mode only. Syncs from pending WS progress requests, generate flags,
 * Director, Explorer, replication, and gallery catchup.
 *
 * Test: scripts/test-desktop-cursors.js. Yozora #457.
 */
(function () {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;

    const WINDOW_FOR_TYPE = {
        generate_image: 'manualModal',
        generate_preset: 'manualModal',
        reroll_image: 'manualModal',
        expand_image: 'manualModal',
        reroll_expanded_image: 'manualModal',
        upscale_image: 'manualModal',
        enhance_image: 'manualModal',
        max_enhance_image: 'manualModal',
        animate_image: 'manualModal',
        compile_dynamic_generation: 'manualModal',
        apply_tendai_preview: 'manualModal',
        novel_generate: 'manualModal',
        resolve_dynamic_context: 'manualModal',
        request_gallery: 'galleryWindow',
        director_send_message: 'directorWindow',
        send_chat_message: 'directorWindow',
        upload_novelai_explore_image: 'tagWikiSearchModal',
        import_fandom_wiki_page: 'tagWikiSearchModal'
    };

    const FALLBACK_PROGRESS = {
        generate_image: true,
        generate_preset: true,
        expand_image: true,
        reroll_expanded_image: true,
        reroll_image: true,
        upscale_image: true,
        enhance_image: true,
        max_enhance_image: true,
        animate_image: true,
        upload_novelai_explore_image: true,
        compile_dynamic_generation: true,
        apply_tendai_preview: true,
        novel_generate: true,
        director_send_message: true,
        send_chat_message: true,
        import_fandom_wiki_page: true,
        request_gallery: true,
        resolve_dynamic_context: true,
        recompile_runtime_assets: true
    };

    const state = {
        bound: false,
        raf: 0,
        lastWindows: Object.create(null),
        lastProgress: false,
        snapshot: { windows: {}, background: {}, reasons: [] }
    };

    function clientClass() {
        return win && win.WebSocketClient ? win.WebSocketClient : null;
    }

    function isSilentType(type) {
        const C = clientClass();
        if (C && C.SILENT_TICKER_REQUEST_TYPES) return C.SILENT_TICKER_REQUEST_TYPES.has(type);
        return type === 'ping';
    }

    function isLightType(type) {
        const C = clientClass();
        if (C && C.LIGHT_REQUEST_TYPES) return C.LIGHT_REQUEST_TYPES.has(type);
        return false;
    }

    function isProgressType(type) {
        if (!type || isSilentType(type) || isLightType(type)) return false;
        if (WINDOW_FOR_TYPE[type]) return true;
        const C = clientClass();
        if (C && C.PROGRESS_REQUEST_TYPES) return C.PROGRESS_REQUEST_TYPES.has(type);
        return !!FALLBACK_PROGRESS[type];
    }

    function mark(map, key) {
        if (!key) return;
        map[key] = true;
    }

    function classifyPending(requests) {
        const windows = Object.create(null);
        const background = Object.create(null);
        const reasons = [];
        if (!requests) return { windows, background, reasons };
        const list = requests instanceof Map ? requests.values() : requests;
        for (const req of list) {
            if (!req || req.silentTicker || req.counted === false) continue;
            const type = req.type;
            if (!isProgressType(type)) continue;
            const windowId = WINDOW_FOR_TYPE[type] || null;
            if (windowId) mark(windows, windowId);
            mark(background, type);
            reasons.push(type);
        }
        return { windows, background, reasons };
    }

    function collectLiveFlags(snapshot) {
        // isGenerating: public/scripts/comp/generationOrchestrator.js (Studio generate)
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            mark(snapshot.windows, 'manualModal');
            mark(snapshot.background, 'generate');
            snapshot.reasons.push('generate');
        }
        if (win && win.spellbookModalManager && win.spellbookModalManager.isGenerating) {
            mark(snapshot.windows, 'spellbookGenerationModal');
            mark(snapshot.background, 'generate');
            snapshot.reasons.push('spellbook');
        }
        if (win && win.mcpRemoteGenerating) {
            mark(snapshot.background, 'generate');
            snapshot.reasons.push('mcp-generate');
        }
        // directorInstance: public/scripts/comp/director.js
        const director = win && win.directorInstance;
        if (director && director._running) {
            mark(snapshot.windows, 'directorWindow');
            mark(snapshot.background, 'director');
            snapshot.reasons.push('director');
        }
        // explorerApplet: public/scripts/comp/explorerApplet.js
        if (typeof explorerApplet !== 'undefined' && explorerApplet
            && (explorerApplet._busyKind || explorerApplet._loading)) {
            mark(snapshot.windows, 'explorerModal');
            mark(snapshot.background, 'explorer');
            snapshot.reasons.push(explorerApplet._busyKind || 'explorer-load');
        }
        if (doc) {
            const gen = doc.getElementById('imageGenerationIndicator');
            if (gen && gen.classList.contains('active')) {
                mark(snapshot.background, 'generate');
            }
            const repl = doc.getElementById('replicationTrayIndicator');
            if (repl && repl.classList.contains('active')) {
                mark(snapshot.background, 'replication');
                snapshot.reasons.push('replication');
            }
            const catchup = doc.getElementById('galleryCatchupBusyLine');
            if (catchup && !catchup.classList.contains('hidden')) {
                mark(snapshot.windows, 'galleryWindow');
                mark(snapshot.background, 'gallery-catchup');
                snapshot.reasons.push('gallery-catchup');
            }
        }
        return snapshot;
    }

    function collect(pendingOverride) {
        const pending = pendingOverride !== undefined
            ? pendingOverride
            : (win && win.wsClient && win.wsClient.pendingRequests);
        const snapshot = classifyPending(pending);
        if (pendingOverride === undefined) collectLiveFlags(snapshot);
        return snapshot;
    }

    function setWindowBusy(id, busy) {
        if (!doc || !id) return;
        const el = doc.getElementById(id);
        if (!el) return;
        if (busy) {
            el.setAttribute('aria-busy', 'true');
            el.setAttribute('data-task-busy', '1');
        } else if (el.getAttribute('data-task-busy') === '1') {
            el.removeAttribute('aria-busy');
            el.removeAttribute('data-task-busy');
        }
    }

    function apply(snapshot) {
        state.snapshot = snapshot;
        if (!doc || !doc.documentElement) return snapshot;
        const desktop = !!(win && win.isDesktop);
        const progress = desktop && Object.keys(snapshot.background).length > 0;
        if (progress) {
            doc.documentElement.setAttribute('data-task-cursor', 'progress');
        } else {
            doc.documentElement.removeAttribute('data-task-cursor');
        }
        state.lastProgress = progress;

        const next = snapshot.windows;
        Object.keys(state.lastWindows).forEach((id) => {
            if (!next[id]) setWindowBusy(id, false);
        });
        Object.keys(next).forEach((id) => {
            if (desktop) setWindowBusy(id, true);
        });
        state.lastWindows = next;
        return snapshot;
    }

    function syncNow() {
        return apply(collect());
    }

    function sync() {
        if (!doc || !win) {
            state.snapshot = collect();
            return state.snapshot;
        }
        if (state.raf) return state.snapshot;
        state.raf = win.requestAnimationFrame(() => {
            state.raf = 0;
            syncNow();
        });
        return state.snapshot;
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        syncNow();
    }

    const api = {
        WINDOW_FOR_TYPE,
        isProgressType,
        classifyPending,
        collect,
        apply,
        sync,
        syncNow,
        bind,
        _test: { state }
    };

    if (win) {
        win.desktopTaskMonitor = api;
        if (doc) {
            if (doc.readyState === 'loading') {
                doc.addEventListener('DOMContentLoaded', bind);
            } else {
                bind();
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
