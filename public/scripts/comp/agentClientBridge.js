/**
 * Client side of the localhost agent session bridge.
 * Invisible inbound handler only — no applet, no Control Panel row, no share dialog.
 * Depends on: wsInboundRegistry, studioChangeJson, openManualModalWithContent
 */

(function initAgentClientBridge() {
    let sessionBound = false;
    let sessionClientId = null;

    function replyAgentSessionResult(requestId, data) {
        if (!window.wsClient || typeof window.wsClient.sendAcklessMessage !== 'function') return;
        try {
            window.wsClient.sendAcklessMessage('agent_session_result', {
                requestId,
                data: data || {}
            });
        } catch (_err) {
            // HTTP side times out if the reply never arrives
        }
    }

    function filenameFromImageLike(img) {
        if (!img || typeof img !== 'object') return null;
        return img.filename || img.original || img.upscaled || img.sourceFilename || null;
    }

    function readOpenFilename() {
        // Preview is what the editor is actually showing. currentEditMetadata /
        // uploadedImageData are variation/img2img sources and often have no filename.
        const showing = filenameFromImageLike(window.currentManualPreviewImage);
        if (showing) return showing;
        const loaded = filenameFromImageLike(window.currentEditImage);
        if (loaded) return loaded;
        const meta = window.currentEditMetadata;
        if (meta) {
            if (meta.sourceFilename) return meta.sourceFilename;
            if (meta.filename) return meta.filename;
        }
        const uploaded = window.uploadedImageData;
        if (uploaded && uploaded.filename) return uploaded.filename;
        return null;
    }

    function readModel() {
        if (typeof manualSelectedModel !== 'undefined' && manualSelectedModel) {
            return manualSelectedModel;
        }
        return null;
    }

    function readWorkspaceId() {
        return window.currentWorkspace || null;
    }

    const WINDOW_TEXT_CAP = 12000;
    const WINDOW_FILE_CAP = 60;

    function capText(value) {
        const text = String(value == null ? '' : value);
        if (text.length <= WINDOW_TEXT_CAP) return text;
        return `${text.slice(0, WINDOW_TEXT_CAP)}\n…[truncated ${text.length - WINDOW_TEXT_CAP} chars]`;
    }

    function jsonClone(value) {
        if (value === undefined) return null;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_err) {
            return String(value);
        }
    }

    function inspectComputedStyle(el, styleAllowlist) {
        const computed = getComputedStyle(el);
        const styles = {};
        if (styleAllowlist) {
            for (let i = 0; i < styleAllowlist.length; i++) {
                const prop = styleAllowlist[i];
                styles[prop] = computed.getPropertyValue(prop);
            }
            return styles;
        }
        for (let i = 0; i < computed.length; i++) {
            const prop = computed[i];
            styles[prop] = computed.getPropertyValue(prop);
        }
        return styles;
    }

    function elementIsVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        return el.getClientRects().length > 0;
    }

    function inspectElementInfo(el, opts) {
        const info = {
            tag: el.tagName ? el.tagName.toLowerCase() : '',
            id: el.id || '',
            className: typeof el.className === 'string' ? el.className : ''
        };
        if (opts.text) info.text = capText(el.textContent || '');
        if (opts.html) info.html = capText(el.outerHTML);
        if (opts.style) info.style = inspectComputedStyle(el, opts.styleAllowlist);
        if (opts.visible) info.visible = elementIsVisible(el);
        if (opts.box) {
            const rect = el.getBoundingClientRect();
            info.box = {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            };
        }
        if (opts.attrs && typeof el.getAttributeNames === 'function') {
            const names = el.getAttributeNames();
            const attrs = {};
            const cap = Math.min(names.length, 40);
            for (let i = 0; i < cap; i++) {
                attrs[names[i]] = el.getAttribute(names[i]);
            }
            info.attrs = attrs;
        }
        return info;
    }

    async function runClientJsFromCommand(script) {
        const source = script == null ? '' : String(script);
        if (!source.trim()) {
            return { error: 'script is empty' };
        }
        try {
            const raw = (0, eval)(source);
            let value = raw;
            if (raw && typeof raw.then === 'function') {
                value = await Promise.race([
                    raw,
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('script timed out')), 12000);
                    })
                ]);
            }
            return { result: jsonClone(value) };
        } catch (err) {
            return { error: (err && err.message) || String(err) };
        }
    }

    function inspectElementsFromCommand(data) {
        try {
            const selectors = Array.isArray(data.selectors) ? data.selectors : [];
            const opts = {
                html: data.html !== false,
                style: data.style !== false,
                text: data.text !== false,
                visible: data.visible !== false,
                box: data.box === true,
                attrs: data.attrs === true,
                styleAllowlist: Array.isArray(data.styleAllowlist) ? data.styleAllowlist : null
            };
            const maxMatches = 50;
            let remaining = maxMatches;
            const result = [];
            for (let s = 0; s < selectors.length; s++) {
                const selector = selectors[s];
                const entry = { selector, matches: [] };
                let els;
                try {
                    els = document.querySelectorAll(selector);
                } catch (selErr) {
                    entry.error = (selErr && selErr.message) || String(selErr);
                    result.push(entry);
                    continue;
                }
                const take = Math.min(els.length, remaining);
                for (let i = 0; i < take; i++) {
                    entry.matches.push(inspectElementInfo(els[i], opts));
                }
                entry.count = els.length;
                if (els.length > take) entry.truncated = true;
                remaining -= take;
                result.push(entry);
                if (remaining <= 0) break;
            }
            return { result };
        } catch (err) {
            return { error: (err && err.message) || String(err) };
        }
    }

    function clientUpdateStatusSnapshot() {
        const sw = window.serviceWorkerManager;
        if (!sw) {
            return { readyForRestart: true, alreadyCurrent: true, reason: 'no-sw' };
        }
        if (sw.agentSession) {
            return { readyForRestart: true, alreadyCurrent: true, reason: 'agent-mode-no-sw' };
        }
        const pending = typeof sw.hasPendingUpdates === 'function' && sw.hasPendingUpdates();
        return {
            readyForRestart: !!pending,
            alreadyCurrent: !pending,
            isUpdating: !!sw.isUpdating,
            progress: sw.updateProgress || 0,
            pendingUpdateKind: sw.pendingUpdateKind || null,
            files: sw.pendingUpdateFilesTotal || 0
        };
    }

    function downloadCountsFromClientUpdate(dl, filesToUpdate) {
        const downloaded = dl && (dl.filesDownloaded != null ? dl.filesDownloaded : dl.completed);
        const listed = filesToUpdate && filesToUpdate.length ? filesToUpdate.length : 0;
        return {
            filesDownloaded: downloaded != null ? downloaded : listed,
            total: (dl && dl.total) || listed,
            stalled: !!(dl && dl.stalled)
        };
    }

    async function settlePreparedClientUpdate(sw, filesToUpdate, dl) {
        const list = (filesToUpdate && filesToUpdate.length) ? filesToUpdate : (sw.pendingApplyFiles || []);
        const counts = downloadCountsFromClientUpdate(dl, list);
        if (!list.length) {
            return {
                ok: true,
                appliedWithoutRestart: false,
                ...clientUpdateStatusSnapshot(),
                ...counts
            };
        }
        // classifyStaticCacheUpdate / applyStaticCacheUpdate: public/scripts/comp/serviceWorkerManager.js
        const kind = sw.classifyStaticCacheUpdate(list);
        if (kind === 'css-only' || kind === 'apply-safe') {
            await sw.applyStaticCacheUpdate(list, { silent: true });
            return {
                ok: true,
                appliedWithoutRestart: true,
                alreadyCurrent: true,
                readyForRestart: false,
                pendingUpdateKind: kind,
                ...counts
            };
        }
        const after = clientUpdateStatusSnapshot();
        return {
            ok: true,
            appliedWithoutRestart: false,
            readyForRestart: true,
            alreadyCurrent: false,
            pendingUpdateKind: kind || after.pendingUpdateKind || 'restart',
            ...counts
        };
    }

    async function prepareClientUpdateFromCommand() {
        const sw = window.serviceWorkerManager;
        const baseline = clientUpdateStatusSnapshot();
        if (!sw || sw.agentSession) {
            return { ok: true, ...baseline };
        }
        if (baseline.readyForRestart && (baseline.pendingUpdateKind === 'css-only' || baseline.pendingUpdateKind === 'apply-safe')) {
            return settlePreparedClientUpdate(sw, sw.pendingApplyFiles, null);
        }
        try {
            // Same as desktop context-menu Update (refresh-cache):
            // refreshServerCache: public/scripts/websocket.js
            // refreshServerCacheAndCheck: public/scripts/comp/serviceWorkerManager.js
            if (wsClient.isConnected()) {
                await wsClient.refreshServerCache();
            }
            if (sw.isUpdating) {
                // attachToDownloadProgress: public/scripts/comp/serviceWorkerManager.js
                const dl = await sw.attachToDownloadProgress({ allowSkip: false });
                return settlePreparedClientUpdate(sw, sw.pendingApplyFiles, dl);
            }
            const response = await fetch('/', {
                method: 'OPTIONS',
                headers: {
                    'X-Service-Worker-Version': '2.0',
                    'X-Requested-With': 'ServiceWorker'
                }
            });
            if (!response.ok) {
                return { ok: false, error: 'manifest fetch failed', status: response.status };
            }
            const files = await response.json();
            // getFilesNeedingUpdate: public/scripts/comp/serviceWorkerManager.js
            const filesToUpdate = await sw.getFilesNeedingUpdate(files);
            if (!filesToUpdate.length) {
                return { ok: true, ...clientUpdateStatusSnapshot() };
            }
            const dl = await sw.attachToDownloadProgress({
                files: filesToUpdate,
                allowSkip: false
            });
            return settlePreparedClientUpdate(sw, filesToUpdate, dl);
        } catch (err) {
            return { ok: false, error: (err && err.message) || String(err) };
        }
    }

    function clickTestingOfferNo() {
        const dialog = document.getElementById('confirmationDialog');
        if (!dialog || dialog.classList.contains('hidden') || dialog.dataset.agentTestingOffer !== '1') {
            return false;
        }
        const buttons = dialog.querySelectorAll('.confirmation-controls button');
        const noBtn = buttons.length ? buttons[buttons.length - 1] : null;
        if (noBtn) {
            noBtn.click();
            return true;
        }
        // hideConfirmationDialog: public/scripts/comp/confirmationDialog.js
        hideConfirmationDialog();
        return true;
    }

    function showTestingOfferDialog(data) {
        const timeoutMs = Number(data && data.timeoutMs) || 15000;
        return new Promise((resolve) => {
            let settled = false;
            const finish = (accepted) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const dialog = document.getElementById('confirmationDialog');
                if (dialog && dialog.dataset.agentTestingOffer === '1') {
                    delete dialog.dataset.agentTestingOffer;
                }
                resolve({ ok: true, accepted: accepted === true });
            };
            const timer = setTimeout(() => {
                clickTestingOfferNo();
                finish(false);
            }, timeoutMs);
            // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
            showConfirmationDialog(
                'Do you want to use this client for development testing?\n\nIf you do nothing, the nearest client stays selected.',
                [
                    { text: 'Yes', value: true, className: 'btn-standard primary' },
                    { text: 'No', value: false, className: 'btn-standard' }
                ],
                null,
                { title: 'Development testing', icon: 'fas fa-display' }
            ).then((value) => {
                finish(value === true);
            });
            const dialog = document.getElementById('confirmationDialog');
            if (dialog) dialog.dataset.agentTestingOffer = '1';
        });
    }

    function restartClientFromCommand() {
        const sw = window.serviceWorkerManager;
        if (sw && typeof sw.forceRestart === 'function') {
            sw.forceRestart();
            return { ok: true, restarting: true };
        }
        if (typeof bypassConfirmation !== 'undefined') {
            bypassConfirmation = true;
        }
        setTimeout(() => {
            try {
                window.location.reload();
            } catch (_err) {
                window.location.href = window.location.href;
            }
        }, 100);
        return { ok: true, restarting: true };
    }

    function capFilenames(list) {
        const names = [];
        const seen = new Set();
        (list || []).forEach((name) => {
            if (!name || seen.has(name) || names.length >= WINDOW_FILE_CAP) return;
            seen.add(name);
            names.push(name);
        });
        return names;
    }

    function classifyOpenWindowKind(modal) {
        const id = modal && modal.id ? String(modal.id) : '';
        if (id === 'galleryWindow') return 'gallery';
        if (id === 'manualModal') return 'studio';
        if (id === 'tagWikiSearchModal') return 'grimoire';
        if (id === 'photoSwipeWindow') return 'glancewell';
        if (id.indexOf('imageViewer_') === 0) return 'lumen';
        const ident = modal && modal.dataset ? String(modal.dataset.windowIdentifier || '') : '';
        if (ident.indexOf('imageViewer:') === 0) return 'lumen';
        if (ident === 'grimoire') return 'grimoire';
        if (/^dsap:\/\//i.test(ident) || id.indexOf('dsap') === 0) return 'dsap';
        return 'window';
    }

    function collectGlancewellWindowData() {
        // getActivePhotoSwipe: public/scripts/comp/lightbox.js
        const pswp = getActivePhotoSwipe();
        if (!pswp || !pswp.isOpen) return null;
        const current = pswp.currSlide && pswp.currSlide.data;
        const currentFilename = filenameFromImageLike(current);
        const source = pswp.options && pswp.options.dataSource;
        const names = [];
        const n = pswp.numItems || (Array.isArray(source) ? source.length : 0);
        for (let i = 0; i < n && names.length < WINDOW_FILE_CAP; i += 1) {
            const data = Array.isArray(source) ? source[i] : null;
            const name = filenameFromImageLike(data);
            if (name) names.push(name);
        }
        return {
            filename: currentFilename,
            filenames: capFilenames(names.length ? names : (currentFilename ? [currentFilename] : [])),
            index: pswp.currIndex,
            count: n
        };
    }

    function collectLumenWindowData(modal) {
        // imageViewerManager: public/scripts/comp/imageViewer.js
        const viewer = imageViewerManager.viewers.get(modal.id);
        const filename = viewer ? viewer.getImageFilename() : null;
        return { filename };
    }

    function collectGalleryWindowData() {
        // getSelectedFilenames: public/scripts/comp/galleryView.js
        const selected = capFilenames(getSelectedFilenames());
        return {
            selected,
            selectedCount: selected.length,
            workspaceId: activeWorkspace || readWorkspaceId()
        };
    }

    function collectGrimoireWindowData() {
        // tagWikiSearchModal.getDisplayText: public/scripts/comp/tagWikiSearchModal.js
        const pathEl = document.getElementById('grimoireAddressPath');
        const url = pathEl ? String(pathEl.textContent || '').trim() : '';
        return {
            url,
            text: capText(tagWikiSearchModal.getDisplayText())
        };
    }

    function collectStudioWindowData() {
        return {
            filename: readOpenFilename(),
            model: readModel()
        };
    }

    function collectWindowData(kind, modal) {
        if (kind === 'gallery') return collectGalleryWindowData();
        if (kind === 'studio') return collectStudioWindowData();
        if (kind === 'grimoire') return collectGrimoireWindowData();
        if (kind === 'glancewell') return collectGlancewellWindowData() || {};
        if (kind === 'lumen') return collectLumenWindowData(modal);
        return {};
    }

    // Window geometry on the wire is viewport percent only (0-100). Pixels stay inside the client.
    function percentToPixels(value, total) {
        return Math.round((Number(value) / 100) * total);
    }

    function pixelsToPercent(value, total) {
        if (!total) return 0;
        return Math.round((value / total) * 1000) / 10;
    }

    function windowGeometryPercent(modal) {
        const rect = modal.getBoundingClientRect();
        return {
            left: pixelsToPercent(rect.left, window.innerWidth),
            top: pixelsToPercent(rect.top, window.innerHeight),
            width: pixelsToPercent(rect.width, window.innerWidth),
            height: pixelsToPercent(rect.height, window.innerHeight)
        };
    }

    function windowIsMinimised(modal) {
        return modal.classList.contains('minimised') || modal.classList.contains('minimising');
    }

    const SET_WINDOW_ACTIONS = ['focus', 'minimize', 'close', 'move', 'resize'];
    const SET_WINDOW_GEOMETRY_KEYS = ['left', 'top', 'width', 'height'];
    const SET_WINDOW_PIXEL_KEYS = ['x', 'y', 'px', 'pixels', 'unit', 'right', 'bottom'];

    function setWindowFromCommand(data) {
        const action = String(data && data.action || '').toLowerCase();
        if (SET_WINDOW_ACTIONS.indexOf(action) === -1) {
            return { ok: false, error: `action must be one of ${SET_WINDOW_ACTIONS.join(', ')}` };
        }
        const pixelKey = SET_WINDOW_PIXEL_KEYS.find((key) => data[key] !== undefined);
        if (pixelKey) {
            return { ok: false, error: `${pixelKey} is not accepted; use left, top, width, height as viewport percent (0-100)` };
        }
        for (let i = 0; i < SET_WINDOW_GEOMETRY_KEYS.length; i += 1) {
            const key = SET_WINDOW_GEOMETRY_KEYS[i];
            if (data[key] === undefined) continue;
            const n = Number(data[key]);
            if (!Number.isFinite(n) || n < 0 || n > 100) {
                return { ok: false, error: `${key} must be a viewport percent between 0 and 100` };
            }
        }
        const modal = data && data.id ? document.getElementById(String(data.id)) : null;
        if (!modal || !modal.classList.contains('modal') || modal.classList.contains('hidden')) {
            return { ok: false, error: 'No open window with that id' };
        }
        // bringModalToFront / restoreMinimizedModal / minimizeModalProgrammatically / closeModal /
        // isModalMaximized / restoreModalFromMaximize / setModalPositionFromViewportRect: public/scripts/comp/modalUtils.js
        if (action === 'close') {
            // Same path as the taskbar close: the window's own close button runs its close hooks
            const closeBtn = modal.querySelector('.modal-window-controls .close-btn');
            if (closeBtn) closeBtn.click();
            else closeModal(modal);
            return { ok: true, id: modal.id, action, closed: true };
        }
        if (action === 'minimize') {
            minimizeModalProgrammatically(modal);
            return { ok: true, id: modal.id, action, minimised: true, ...windowGeometryPercent(modal) };
        }
        if (modal.classList.contains('minimised')) {
            restoreMinimizedModal(modal, null);
        }
        if (action === 'move' || action === 'resize') {
            if (action === 'move' && data.left === undefined && data.top === undefined) {
                return { ok: false, error: 'move needs left and/or top' };
            }
            if (action === 'resize' && data.width === undefined && data.height === undefined) {
                return { ok: false, error: 'resize needs width and/or height' };
            }
            if (isModalMaximized(modal)) {
                restoreModalFromMaximize(modal);
            }
            const rect = modal.getBoundingClientRect();
            const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            if (action === 'move') {
                if (data.left !== undefined) next.left = percentToPixels(data.left, window.innerWidth);
                if (data.top !== undefined) next.top = percentToPixels(data.top, window.innerHeight);
            } else {
                if (data.width !== undefined) next.width = percentToPixels(data.width, window.innerWidth);
                if (data.height !== undefined) next.height = percentToPixels(data.height, window.innerHeight);
            }
            setModalPositionFromViewportRect(modal, next);
        }
        bringModalToFront(modal);
        return {
            ok: true,
            id: modal.id,
            action,
            minimised: windowIsMinimised(modal),
            maximised: isModalMaximized(modal),
            ...windowGeometryPercent(modal)
        };
    }

    async function openApplicationFromCommand(data) {
        const launchId = data && data.launchId ? String(data.launchId).trim() : '';
        if (!launchId) return { ok: false, error: 'launchId is required' };
        // findStartMenuLaunchableById / startMenuLaunchables / buildToolsSubmenuItems / flattenToolsSubmenuItems: public/scripts/comp/modalUtils.js
        let item = findStartMenuLaunchableById(launchId);
        if (!item) item = startMenuLaunchables.find((entry) => entry.launchId === launchId) || null;
        if (!item) item = flattenToolsSubmenuItems(buildToolsSubmenuItems()).find((entry) => entry.launchId === launchId) || null;
        if (!item || typeof item.action !== 'function') {
            return { ok: false, error: `Unknown launchId: ${launchId}` };
        }
        if (launchId === 'studio') {
            const wasOpen = studioEditorIsOpen();
            if (wasOpen) {
                const modal = document.getElementById('manualModal');
                if (modal) openModal(modal);
                return { ok: true, launchId, text: item.text || launchId, fresh: false };
            }
            await openManualModalWithContent({ type: 'none', skipPreviewRestore: true }, null);
            // startStudioNewSession: public/scripts/comp/studioSession.js
            startStudioNewSession({ keepHistory: true, quiet: true });
            return { ok: true, launchId, text: item.text || launchId, fresh: true };
        }
        await item.action();
        return { ok: true, launchId, text: item.text || launchId };
    }

    function collectOpenWindowsSnapshot() {
        // getOpenTaskbarModals / getModalTitle / currentActiveWindowId: public/scripts/comp/modalUtils.js
        const seen = new Set();
        const modals = getOpenTaskbarModals().slice();
        const pswpShell = document.getElementById('photoSwipeWindow');
        if (pswpShell && !pswpShell.classList.contains('hidden') && !seen.has(pswpShell.id)) {
            if (!modals.some((modal) => modal.id === pswpShell.id)) modals.push(pswpShell);
        }
        // imageViewerManager: public/scripts/comp/imageViewer.js
        imageViewerManager.viewers.forEach((_viewer, id) => {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden') && !modals.some((modal) => modal.id === id)) {
                modals.push(el);
            }
        });
        const windows = [];
        modals.forEach((modal) => {
            if (!modal || !modal.id || seen.has(modal.id)) return;
            if (modal.classList.contains('hidden') || modal.classList.contains('closing')) return;
            seen.add(modal.id);
            const kind = classifyOpenWindowKind(modal);
            windows.push({
                id: modal.id,
                kind,
                title: getModalTitle(modal) || modal.id,
                active: modal.id === currentActiveWindowId,
                minimised: windowIsMinimised(modal),
                // isModalMaximized: public/scripts/comp/modalUtils.js
                maximised: isModalMaximized(modal),
                ...windowGeometryPercent(modal),
                data: collectWindowData(kind, modal)
            });
        });
        windows.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return 0;
        });
        return {
            workspaceId: readWorkspaceId(),
            activeWindowId: currentActiveWindowId || null,
            windows
        };
    }

    function buildPromptUcChange(data) {
        const fields = [];
        if (data.prompt != null) {
            fields.push({
                id: 'prompt',
                action: 'replace',
                chunks: [{ name: 'Prompt', text: String(data.prompt) }]
            });
        }
        if (data.uc != null) {
            fields.push({
                id: 'uc',
                action: 'replace',
                chunks: [{ name: 'UC', text: String(data.uc) }]
            });
        }
        if (!fields.length) return null;
        return { dreamscape: 'change', v: 1, fields };
    }

    function resolveStudioPayload(data) {
        if (!data || typeof data !== 'object') return null;
        if (data.change && typeof data.change === 'object' && !Array.isArray(data.change)) {
            return data.change;
        }
        const text = resolveStudioText(data);
        if (!text || typeof window.extractStudioChangeJson !== 'function') return null;
        return window.extractStudioChangeJson(text);
    }

    function readVSliderHydration(payload) {
        const requested = payload && Array.isArray(payload.vSlider) ? payload.vSlider.length : 0;
        let installed = 0;
        try {
            const snap = typeof getStudioVSliderSnapshot === 'function' ? getStudioVSliderSnapshot() : null;
            installed = snap && snap.length ? snap.length : 0;
        } catch (_err) {
            installed = 0;
        }
        return {
            vSlider: installed ? getStudioVSliderSnapshot() : null,
            vSliderRequested: requested,
            vSliderInstalled: installed,
            vSliderRejected: requested > installed ? requested - installed : 0,
            vSliderHydrated: requested === 0 || installed > 0
        };
    }

    function resolveStudioText(data) {
        if (!data || typeof data !== 'object') return null;
        if (typeof data.change === 'string') return data.change;
        if (data.change && typeof data.change === 'object') return JSON.stringify(data.change);
        if (data.payload) {
            if (typeof data.payload === 'string') return data.payload;
            if (typeof data.payload === 'object') return JSON.stringify(data.payload);
        }
        const built = buildPromptUcChange(data);
        return built ? JSON.stringify(built) : null;
    }

    function readBoolFlag(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        if (typeof value === 'boolean') return value;
        if (value === 1 || value === '1' || value === 'true') return true;
        if (value === 0 || value === '0' || value === 'false') return false;
        return defaultValue;
    }

    function isPrintsReviewOpen() {
        const el = document.getElementById('stageResultsReview');
        return !!(el && !el.classList.contains('hidden'));
    }

    function dismissPrintsReview() {
        const el = document.getElementById('stageResultsReview');
        if (!el) return;
        if (typeof closeModal === 'function') {
            closeModal(el);
            return;
        }
        el.classList.add('hidden');
    }

    function fireBoundTabGenerate(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const nWasSet = opts.n != null && opts.n !== '';
        const prints = nWasSet ? parseInt(opts.n, 10) : 1;
        if (typeof setManualPrintsCount === 'function' && Number.isFinite(prints)) {
            setManualPrintsCount(Math.max(1, Math.min(8, prints)));
        }
        if (isPrintsReviewOpen()) {
            dismissPrintsReview();
        }
        const btn = document.getElementById('manualGenerateBtn');
        const filenameBefore = window.lastGeneratedImageName || null;
        const studioFilename = typeof readOpenFilename === 'function' ? readOpenFilename() : null;
        if (!btn) {
            return {
                generateStarted: false,
                generateError: 'Generate button is not available',
                filenameBefore,
                filenameExpected: studioFilename
            };
        }
        if (btn.disabled) {
            return {
                generateStarted: false,
                blockedBy: isPrintsReviewOpen() ? 'printsReview' : 'generateDisabled',
                generateError: isPrintsReviewOpen()
                    ? 'Prints review is still open'
                    : 'Generate button is disabled',
                filenameBefore,
                filenameExpected: studioFilename
            };
        }
        btn.click();
        return {
            generateStarted: true,
            filenameBefore,
            filenameExpected: studioFilename
        };
    }

    function studioEditorIsOpen() {
        const manualModal = document.getElementById('manualModal');
        return !!(manualModal && !manualModal.classList.contains('hidden'));
    }

    async function openPhasewalkerFromCommand(data) {
        const state = data && data.state;
        if (!state || !Array.isArray(state.keywords) || state.keywords.length === 0) {
            return { ok: false, error: 'Phasewalker state requires at least one keyword' };
        }
        if (!studioEditorIsOpen()) {
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            if (typeof openManualModalWithContent !== 'function') {
                return { ok: false, error: 'Studio is not available' };
            }
            await openManualModalWithContent({ type: 'none' }, null);
        }
        // openBracketGenerationApplet: public/scripts/comp/featureLoader.js
        if (typeof openBracketGenerationApplet !== 'function') {
            return { ok: false, error: 'Phasewalker is not available' };
        }
        const compile = data.compile !== false && studioEditorIsOpen();
        await openBracketGenerationApplet({ state, autoCompile: compile });
        // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
        showAgentSessionTrayNotice('update', data);
        const applet = bracketGenerationApplet;
        const snapshot = applet && typeof applet.getSnapshot === 'function' ? applet.getSnapshot() : state;
        const keywords = snapshot && Array.isArray(snapshot.keywords) ? snapshot.keywords : state.keywords;
        let stepCount = 0;
        keywords.forEach((keyword) => {
            const rows = snapshot && snapshot.keywordSteps ? snapshot.keywordSteps[keyword] : null;
            if (Array.isArray(rows) && rows.length > stepCount) stepCount = rows.length;
        });
        const opened = {
            ok: true,
            compiled: compile,
            editorOpen: studioEditorIsOpen(),
            keywords,
            stepCount,
            change: readStudioChangeSnapshot()
        };
        return typeof maskAgentStudioRead === 'function' ? maskAgentStudioRead(opened) : opened;
    }

    function phasewalkerSnapshot() {
        try {
            // bracketGenerationApplet.getSnapshot: public/scripts/comp/bracketGenerationApplet.js
            const live = bracketGenerationApplet.getSnapshot();
            if (live && Array.isArray(live.keywords) && live.keywords.length) return live;
        } catch (_err) { /* editor not mounted; rebuild from the prompt */ }
        // rebuildToolStateFromEditor: public/scripts/comp/bracketGenerationApplet.js
        return rebuildToolStateFromEditor();
    }

    function phasewalkerPhases(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.keywords) || !snapshot.keywords.length) return [];
        const keyword = snapshot.keywords[0];
        const steps = (snapshot.keywordSteps && snapshot.keywordSteps[keyword]) || [];
        const names = snapshot.stepNames || [];
        return steps.map((step, index) => ({
            index,
            name: names[index] || '',
            prompt: String((step && step.prompt) || '').slice(0, 180)
        }));
    }

    function phasewalkerPhaseIndex(snapshot, phase) {
        const phases = phasewalkerPhases(snapshot);
        const query = String(phase || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (!query) return -1;
        return phases.findIndex((row) => {
            const blob = `${row.name} ${row.prompt} ${row.index}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
            return blob.includes(query) || String(row.index) === String(phase).trim();
        });
    }

    function bakePhasewalkerToken(textarea, token, text) {
        if (!textarea || !token) return;
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('!' + escaped + '\\b', 'g');
        if (!re.test(textarea.value)) return;
        const baked = textarea.value.replace(re, text || '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\s*,\s*,/g, ',')
            .replace(/^\s*,\s*/, '')
            .replace(/\s*,\s*$/, '');
        // setTextareaValuePreservingUndo: public/scripts/comp/textareaUtils.js
        setTextareaValuePreservingUndo(textarea, baked);
        // bracketGenRefreshPromptTextarea: public/scripts/comp/bracketGenerationApplet.js
        bracketGenRefreshPromptTextarea(textarea);
    }

    function phasewalkerIsCompiled() {
        try {
            // hasManagedBracketArtifacts: public/scripts/comp/bracketGenerationApplet.js
            // Loaded by featureLoader.js only after Phasewalker has been opened.
            return hasManagedBracketArtifacts();
        } catch (err) {
            if (err && err.name === 'ReferenceError') return false;
            throw err;
        }
    }

    function phasewalkerBlocksGenerate(data) {
        if (data && data.walk === true) return null;
        if (!phasewalkerIsCompiled()) return null;
        const snapshot = phasewalkerSnapshot();
        return {
            ok: false,
            generateStarted: false,
            needsDecompile: true,
            phases: phasewalkerPhases(snapshot),
            error: 'Phasewalker is still compiled. decompile_phasewalker the chosen phase before generating, or pass walk:true to run every phase again.'
        };
    }

    async function decompilePhasewalkerFromCommand(data) {
        if (!studioEditorIsOpen()) {
            // openManualModalWithContent: public/scripts/comp/manualModalManager.js
            await openManualModalWithContent({ type: 'none' }, null);
        }
        const snapshot = phasewalkerSnapshot();
        const phases = phasewalkerPhases(snapshot);
        if (!snapshot || !phases.length) {
            return { ok: false, error: 'Phasewalker has no compiled phases' };
        }
        const phase = data && (data.phase != null ? data.phase : data.name);
        const index = phasewalkerPhaseIndex(snapshot, phase);
        if (index < 0) {
            return { ok: false, error: 'Name the phase to keep', phases };
        }
        snapshot.keywords.forEach((keyword) => {
            const step = (snapshot.keywordSteps[keyword] || [])[index] || {};
            bakePhasewalkerToken(document.getElementById('manualPrompt'), `${keyword}_P`, step.prompt || '');
            bakePhasewalkerToken(document.getElementById('manualUc'), `${keyword}_N`, step.uc || '');
        });
        // deleteAllManagedBracketArtifacts: public/scripts/comp/bracketGenerationApplet.js
        deleteAllManagedBracketArtifacts();
        try {
            // bracketGenerationApplet.updateChrome: public/scripts/comp/bracketGenerationApplet.js
            bracketGenerationApplet.updateChrome();
        } catch (_err) { /* stages are already gone */ }
        const kept = phases[index];
        const result = {
            ok: true,
            decompiled: true,
            phaseIndex: index,
            phase: kept && (kept.name || kept.prompt),
            change: readStudioChangeSnapshot()
        };
        if (!data || data.autoGenerate !== true) {
            return typeof maskAgentStudioRead === 'function' ? maskAgentStudioRead(result) : result;
        }
        const gen = fireBoundTabGenerate({ n: 1 });
        const generated = { ...result, autoGenerate: true, ...gen };
        return typeof maskAgentStudioRead === 'function' ? maskAgentStudioRead(generated) : generated;
    }

    async function applyStudioFromCommand(data) {
        const autoApply = readBoolFlag(data && data.autoApply, true);
        const autoGenerate = readBoolFlag(data && data.autoGenerate, false);
        if (!autoApply && autoGenerate) {
            return { ok: false, error: 'autoGenerate requires autoApply' };
        }
        const payload = resolveStudioPayload(data);
        if (!payload) {
            return { ok: false, error: 'change JSON or prompt/uc fields are required' };
        }
        if (!autoApply) {
            return { ok: true, applied: false, autoApply: false, autoGenerate: false };
        }
        if (typeof window.applyStudioChangePayloadSilent !== 'function') {
            return { ok: false, error: 'Studio change helper is not available' };
        }
        const modal = document.getElementById('manualModal');
        const studioWasClosed = !modal || modal.classList.contains('hidden');
        let applied = false;
        try {
            applied = !!await window.applyStudioChangePayloadSilent(payload);
        } catch (err) {
            return {
                ok: false,
                applied: false,
                autoApply: true,
                autoGenerate,
                error: (err && err.message) || 'Failed to apply studio change'
            };
        }
        const hydration = readVSliderHydration(payload);
        if (!applied) {
            return {
                ok: false,
                applied: false,
                autoApply: true,
                autoGenerate,
                ...hydration,
                error: hydration.vSliderRejected
                    ? 'Studio change was not applied (vSlider catalog did not hydrate — check kind, axes, and 2+ stops per axis)'
                    : 'Studio change was not applied'
            };
        }
        const partialVSlider = hydration.vSliderRejected > 0;
        // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
        showAgentSessionTrayNotice(studioWasClosed ? 'open' : 'update', data);
        const checkpointId = storeStudioCheckpoint(captureStudioCheckpointPayload());
        const baseResult = {
            ok: true,
            applied: true,
            autoApply: true,
            opened: studioWasClosed,
            workspaceId: readWorkspaceId(),
            checkpointId,
            ...hydration,
            // studioChangeLastMediumUcFold: public/scripts/comp/studioChangeJson.js
            ...(typeof studioChangeLastMediumUcFold !== 'undefined' && studioChangeLastMediumUcFold
                ? { mediumUcFolded: studioChangeLastMediumUcFold }
                : {}),
            ...(partialVSlider ? {
                partial: true,
                warning: 'Prompt/expanders applied but vSlider catalog did not hydrate — fix kind, axes, and 2+ stops per axis, then retry vSlider only.'
            } : {})
        };
        if (!autoGenerate) {
            return { ...baseResult, autoGenerate: false };
        }
        const blocked = phasewalkerBlocksGenerate(data);
        if (blocked) return { ...baseResult, ...blocked, applied: true };
        const nHint = payload && payload.params && payload.params.n != null
            ? payload.params.n
            : (data && data.n);
        const gen = fireBoundTabGenerate({ n: nHint });
        return {
            ...baseResult,
            autoGenerate: true,
            lastGeneratedImageName: window.lastGeneratedImageName || null,
            filename: typeof readOpenFilename === 'function' ? readOpenFilename() : null,
            ...gen
        };
    }

    async function openImageFromCommand(filename, commandData) {
        if (!filename) return { ok: false, error: 'filename is required' };
        if (typeof openManualModalWithContent !== 'function') {
            return { ok: false, error: 'Studio is not available' };
        }
        const image = (typeof findImageByFilename === 'function' && findImageByFilename(filename))
            || { filename };
        // MCP open_in_studio: skip the replace-current confirmation (user clicks keep it).
        await openManualModalWithContent({ type: 'image', image, skipConfirm: true, source: 'mcp' }, null);
        // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
        showAgentSessionTrayNotice('open', commandData);
        return { ok: true, filename };
    }

    function readDynamicPhysicsConfig() {
        const todBtn = document.getElementById('todBtn');
        const weatherBtn = document.getElementById('weatherBtn');
        const seasonBtn = document.getElementById('seasonBtn');
        const config = {};
        // collectDynamicButtonState: public/scripts/comp/dynamicGenerationOverrides.js
        config.tod = collectDynamicButtonState(todBtn);
        config.weather = collectDynamicButtonState(weatherBtn);
        config.season = collectDynamicButtonState(seasonBtn);
        const loc = weatherBtn && weatherBtn.getAttribute('data-location');
        if (loc) config.location = loc;
        return config;
    }

    function readStudioChangeSnapshot() {
        if (typeof window.buildStudioChangeSnapshot === 'function') {
            try {
                return window.buildStudioChangeSnapshot();
            } catch (_err) {
                // fall through to empty editor
            }
        }
        return { dreamscape: 'change', v: 1 };
    }

    let studioCheckpoint = null;

    function newStudioCheckpointId() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function captureStudioCheckpointPayload() {
        return {
            workspaceId: readWorkspaceId(),
            filename: readOpenFilename(),
            model: readModel(),
            change: readStudioChangeSnapshot(),
            dynamicGeneration: typeof readDynamicGenerationSnapshot === 'function'
                ? readDynamicGenerationSnapshot()
                : null,
            director: typeof readDirectorAttachSnapshot === 'function'
                ? readDirectorAttachSnapshot()
                : null,
            lastGeneratedImageName: window.lastGeneratedImageName || null
        };
    }

    function studioValuesEqual(left, right) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch (_err) {
            return left === right;
        }
    }

    function diffStudioCheckpointPayload(prev, next) {
        const keys = ['workspaceId', 'filename', 'model', 'change', 'dynamicGeneration', 'director', 'lastGeneratedImageName'];
        const delta = {};
        let changed = false;
        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!studioValuesEqual(prev && prev[key], next && next[key])) {
                delta[key] = next[key];
                changed = true;
            }
        }
        return { changed, delta };
    }

    function storeStudioCheckpoint(payload) {
        const id = newStudioCheckpointId();
        studioCheckpoint = { id, payload };
        return id;
    }

    function replyStudioState(requestId, extra) {
        const current = captureStudioCheckpointPayload();
        const forceFull = !!(extra && (extra.full === true || extra.full === 'true'));
        const since = extra && (extra.since || extra.checkpointId);
        const canDiff = !forceFull && since && studioCheckpoint && studioCheckpoint.id === since;
        let body;
        if (canDiff) {
            const diffed = diffStudioCheckpointPayload(studioCheckpoint.payload, current);
            const checkpointId = storeStudioCheckpoint(current);
            body = {
                ok: true,
                clientId: sessionClientId,
                checkpointId,
                diff: true,
                unchanged: !diffed.changed,
                ...diffed.delta
            };
        } else {
            const checkpointId = storeStudioCheckpoint(current);
            body = {
                ok: true,
                clientId: sessionClientId,
                checkpointId,
                diff: false,
                unchanged: false,
                ...current
            };
        }
        if (typeof maskAgentStudioRead === 'function') body = maskAgentStudioRead(body);
        replyAgentSessionResult(requestId, body);
    }

    async function handleAgentSessionCommand(message) {
        const requestId = message && message.requestId;
        const data = (message && message.data) || {};
        // Commands are only sent to the bound socket; treat arrival as bind confirmation.
        sessionBound = true;
        if (data.clientId) sessionClientId = data.clientId;
        const command = data.command;
        let keptTop = null;
        try {
            // pushMcpKeepTopWindow / getTopOpenModal / bringModalToFront: public/scripts/comp/modalUtils.js
            if (typeof pushMcpKeepTopWindow === 'function') pushMcpKeepTopWindow();
            keptTop = typeof getTopOpenModal === 'function' ? getTopOpenModal() : null;
            if (command === 'get_state' || command === 'get_editor') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('read', data);
                // readDynamicGenerationSnapshot / readDirectorAttachSnapshot: public/scripts/comp/dynamicGenerationLockState.js
                replyStudioState(requestId, data);
                return;
            }
            if (command === 'get_windows') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('windows', data);
                replyAgentSessionResult(requestId, {
                    ok: true,
                    clientId: sessionClientId,
                    ...collectOpenWindowsSnapshot()
                });
                return;
            }
            if (command === 'get_physics') {
                replyAgentSessionResult(requestId, {
                    ok: true,
                    clientId: sessionClientId,
                    dynamicConfig: readDynamicPhysicsConfig(),
                    // readDynamicGenerationSnapshot: public/scripts/comp/dynamicGenerationLockState.js
                    dynamicGeneration: readDynamicGenerationSnapshot()
                });
                return;
            }
            if (command === 'set_window') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('windows', data);
                replyAgentSessionResult(requestId, setWindowFromCommand(data));
                return;
            }
            if (command === 'open_application') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('open', data);
                replyAgentSessionResult(requestId, await openApplicationFromCommand(data));
                return;
            }
            if (command === 'get_calculator' || command === 'set_calculator') {
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('windows', data);
                // readDesktopCalculatorForAgent / applyDesktopCalculatorAgentAction: public/scripts/comp/desktop-apps/calculator.js
                replyAgentSessionResult(requestId, command === 'get_calculator'
                    ? readDesktopCalculatorForAgent(data)
                    : applyDesktopCalculatorAgentAction(data));
                return;
            }
            if (command === 'director_long_job_notice') {
                // Async void notice: toast only, no dialog, ack as soon as it is queued
                const text = data && data.text ? String(data.text) : 'This is a long job. Director is still working.';
                // showGlassToast: public/scripts/comp/toastManager.js
                showGlassToast('info', 'Director', text, false, 8000, '<i class="fas fa-clapperboard"></i>');
                replyAgentSessionResult(requestId, { ok: true, queued: true });
                return;
            }
            if (command === 'open_image') {
                const result = await openImageFromCommand(data.filename, data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'open_viewer') {
                if (typeof window.openMcpViewer !== 'function') {
                    replyAgentSessionResult(requestId, { ok: false, error: 'Viewer helper is not available' });
                    return;
                }
                const result = await window.openMcpViewer(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'apply_studio') {
                const result = await applyStudioFromCommand(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'print_studio') {
                if (!studioEditorIsOpen()) {
                    replyAgentSessionResult(requestId, {
                        ok: false,
                        generateStarted: false,
                        error: 'Studio is not open'
                    });
                    return;
                }
                const blocked = phasewalkerBlocksGenerate(data);
                if (blocked) {
                    replyAgentSessionResult(requestId, blocked);
                    return;
                }
                const gen = fireBoundTabGenerate({ n: data && data.n });
                replyAgentSessionResult(requestId, {
                    ok: gen.generateStarted === true,
                    workspaceId: readWorkspaceId(),
                    ...gen
                });
                return;
            }
            if (command === 'open_phasewalker') {
                const result = await openPhasewalkerFromCommand(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'decompile_phasewalker') {
                const result = await decompilePhasewalkerFromCommand(data);
                replyAgentSessionResult(requestId, result);
                return;
            }
            if (command === 'run_client_js') {
                replyAgentSessionResult(requestId, await runClientJsFromCommand(data.script));
                return;
            }
            if (command === 'inspect_elements') {
                replyAgentSessionResult(requestId, inspectElementsFromCommand(data));
                return;
            }
            if (command === 'client_prepare_update') {
                replyAgentSessionResult(requestId, await prepareClientUpdateFromCommand());
                return;
            }
            if (command === 'client_restart') {
                replyAgentSessionResult(requestId, { ok: true, restarting: true });
                restartClientFromCommand();
                return;
            }
            if (command === 'client_offer_testing') {
                replyAgentSessionResult(requestId, await showTestingOfferDialog(data));
                return;
            }
            if (command === 'client_dismiss_testing_offer') {
                clickTestingOfferNo();
                replyAgentSessionResult(requestId, { ok: true, dismissed: true, accepted: false });
                return;
            }
            if (command === 'client_update') {
                if (typeof window.showAgentClientUpdateDialog !== 'function') {
                    replyAgentSessionResult(requestId, { ok: false, error: 'Client update dialog is not available' });
                    return;
                }
                const result = await window.showAgentClientUpdateDialog();
                replyAgentSessionResult(requestId, result);
                return;
            }
            replyAgentSessionResult(requestId, { ok: false, error: 'Unknown command' });
        } catch (err) {
            replyAgentSessionResult(requestId, {
                ok: false,
                error: (err && err.message) || 'Command failed'
            });
        } finally {
            if (typeof popMcpKeepTopWindow === 'function') popMcpKeepTopWindow();
            if (!keptTop || keptTop.classList.contains('hidden') || keptTop.classList.contains('closing')) return;
            if (typeof getTopOpenModal !== 'function' || typeof bringModalToFront !== 'function') return;
            const now = getTopOpenModal();
            if (!now || now === keptTop) return;
            // mcpLaunchShouldLeaveOnTop: public/scripts/comp/modalUtils.js
            if (typeof mcpLaunchShouldLeaveOnTop === 'function' && mcpLaunchShouldLeaveOnTop(now)) return;
            bringModalToFront(keptTop);
        }
    }

    /**
     * Console / agent helper. Mints a short share code (no UI, never logs the code).
     * Usage: const { code, clientId, expiresInSec } = await window.agentSessionShareStart();
     */
    async function agentSessionUnbindRequest() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function' || !window.wsClient.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        return window.wsClient.sendMessage('agent_session_unbind', {}, false);
    }

    async function agentSessionShareStart() {
        if (!window.wsClient || typeof window.wsClient.sendMessage !== 'function' || !window.wsClient.isConnected()) {
            throw new Error('WebSocket is not connected');
        }
        const data = await window.wsClient.sendMessage('session_share_start', {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        }, false);
        if (data && data.clientId) sessionClientId = data.clientId;
        return data;
    }

    if (typeof registerWsInboundHandler === 'function') {
        registerWsInboundHandler({
            id: 'agent.session_command',
            type: 'agent_session_command',
            phase: 'only',
            handler(message) {
                void handleAgentSessionCommand(message);
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_bound',
            type: 'agent_session_bound',
            phase: 'only',
            handler(message) {
                sessionBound = true;
                if (message && message.data && message.data.clientId) {
                    sessionClientId = message.data.clientId;
                }
                // showAgentSessionTrayNotice: public/scripts/comp/mcpActivityClient.js
                showAgentSessionTrayNotice('bound', message && message.data);
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_unbound',
            type: 'agent_session_unbound',
            phase: 'only',
            handler() {
                sessionBound = false;
                // markAgentSessionUnbound: public/scripts/comp/mcpActivityClient.js
                markAgentSessionUnbound();
            }
        });
        registerWsInboundHandler({
            id: 'agent.session_notice',
            type: 'agent_session_notice',
            phase: 'only',
            handler(message) {
                const action = message && message.data && message.data.action;
                if (action === 'physics') {
                    // markMcpPhysicsUsed: public/scripts/comp/mcpActivityClient.js
                    markMcpPhysicsUsed(message.data.actorName || message.data.appName);
                }
            }
        });
    }

    if (typeof window !== 'undefined') {
        window.agentSessionShareStart = agentSessionShareStart;
        window.agentSessionUnbindRequest = agentSessionUnbindRequest;
        window.isAgentSessionBound = () => sessionBound;
    }
})();
