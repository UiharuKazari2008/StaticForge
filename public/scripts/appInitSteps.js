/**
 * App Init Steps (Phase 2 — app.js refactor)
 *
 * registerInitStep(0.45–100) boot sequence for StaticForge.
 * Extracted from public/scripts/app.js batch 11.
 */

if (window.wsClient) {
    // Server readiness polling system for when server restarts
    let serverReadinessInterval = null;
    let lastServerReadinessCheck = 0;

    function handleRuntimeCompileProgressBroadcast(data) {
        if (!data || !data.inProgress) {
            return;
        }
        // logViewerApplet — public/scripts/comp/logViewerApplet.js (on-open via featureLoader)
        const logViewerLoaded = typeof logViewerApplet !== 'undefined' && logViewerApplet;
        if (logViewerLoaded && logViewerApplet.onRuntimeCompileProgress) {
            logViewerApplet.onRuntimeCompileProgress({ data });
        }
        if ((!logViewerLoaded || !logViewerApplet._runtimeCompilePopoverLocked) && serviceWorkerManager) {
            serviceWorkerManager.handleRuntimeCompileProgress(data);
        }
    }

    function handleRuntimeCompileCompleteBroadcast(data) {
        // logViewerApplet — public/scripts/comp/logViewerApplet.js (on-open via featureLoader)
        const logViewerLoaded = typeof logViewerApplet !== 'undefined' && logViewerApplet;
        if (logViewerLoaded && logViewerApplet.onRuntimeCompileComplete) {
            logViewerApplet.onRuntimeCompileComplete({ data });
        }
        if ((!logViewerLoaded || !logViewerApplet._runtimeCompilePopoverLocked) && serviceWorkerManager) {
            serviceWorkerManager.handleRuntimeCompileComplete(data);
        }
        if (data && data.errors && data.errors.length > 0) {
            // showRuntimeCompileErrors: public/scripts/appInitSteps.js
            showRuntimeCompileErrors(data.errors);
        }
    }

    let lastRuntimeCompileErrorsKey = '';

    function runtimeCompileErrorsKey(errors) {
        return errors.map(function (entry) {
            return (entry.file || '') + '\0' + (entry.error || '');
        }).join('\n');
    }

    function showRuntimeCompileErrors(errors) {
        if (!errors || !errors.length) {
            return;
        }
        const key = runtimeCompileErrorsKey(errors);
        if (key === lastRuntimeCompileErrorsKey) {
            return;
        }
        lastRuntimeCompileErrorsKey = key;
        const lines = errors.slice(0, 4).map(function (entry) {
            return (entry.file || '(unknown)') + ': ' + (entry.error || 'Unknown error');
        });
        const detail = lines.join('\n') + (errors.length > 4 ? '\n...and ' + (errors.length - 4) + ' more' : '');
        const recompileButton = {
            text: 'Recompile',
            type: 'primary',
            onClick: function () {
                if (!window.wsClient || typeof window.wsClient.recompileRuntimeAssets !== 'function') {
                    return;
                }
                window.wsClient.recompileRuntimeAssets({ force: true }).then(function (result) {
                    if (result && result.success === false && result.errors && result.errors.length) {
                        showRuntimeCompileErrors(result.errors);
                        return;
                    }
                    if (typeof showGlassToast === 'function') {
                        showGlassToast(
                            'success',
                            'Runtime Assets Recompiled',
                            'Optimised CSS and JavaScript were rebuilt successfully.',
                            false,
                            5000,
                            '<i class="fas fa-check"></i>'
                        );
                    }
                }).catch(function (err) {
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('error', 'Recompile Failed', err.message || 'Unknown error', false, false, '<i class="fas fa-exclamation-triangle"></i>');
                    }
                });
            },
            closeOnClick: false
        };

        if (typeof showGlassToast === 'function') {
            showGlassToast(
                'error',
                'Runtime Compile Errors',
                detail,
                false,
                false,
                '<i class="fas fa-exclamation-triangle"></i>',
                [recompileButton]
            );
        } else if (typeof presentDreamscapeApplicationError === 'function') {
            presentDreamscapeApplicationError('Runtime compile errors', detail);
        } else {
            console.error('Runtime compile errors:', detail);
        }
    }

    async function checkServerReadiness() {
        try {
            const response = await fetch('/status', {
                method: 'OPTIONS',
                cache: 'no-cache'
            });

            if (response.ok) {
                const data = await response.json();
                lastServerReadinessCheck = Date.now();

                if (!data.isReady) {
                    console.log(`[startup] ${data.stageMessage} (${data.progressPercent != null ? data.progressPercent + '%' : '…'})`);

                    if (window.wsClient && !window.wsClient.isConnected()) {
                        window.wsClient._applyServerStartupStatus(data);
                        window.wsClient.bannerManager.showWebSocketTicker(
                            'warning',
                            `Server Booting: ${data.stageMessage}${data.progressPercent != null ? ` (${data.progressPercent}%)` : ''}`,
                            'fa-spinner-third fa-spin',
                            false
                        );
                    }
                } else if (window.wsClient && window.wsClient.bannerManager) {
                    window.wsClient.bannerManager.hideWebSocketTicker();
                }

                return data;
            }
        } catch (error) {
            console.warn('⚠️ Server readiness check failed:', error.message);
        }
        return null;
    }

    // Fallback if WS connect push was missed — uses lastServerStartupStatus from pingHost (OPTIONS /status)
    function surfaceBootRuntimeCompileErrorsFromStatus() {
        const status = window.wsClient && window.wsClient.lastServerStartupStatus;
        if (!status || !status.runtimeCompile) {
            return;
        }
        // serverManagement — public/scripts/comp/serverManagement.js (on-open via featureLoader)
        if (typeof serverManagement !== 'undefined' && serverManagement && serverManagement.setRuntimeCompileStatus) {
            serverManagement.setRuntimeCompileStatus(status.runtimeCompile);
        }
        const errors = status.runtimeCompile.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            showRuntimeCompileErrors(errors);
        }
    }

    window.surfaceBootRuntimeCompileErrorsFromStatus = surfaceBootRuntimeCompileErrorsFromStatus;
    window.showRuntimeCompileErrors = showRuntimeCompileErrors;
    window.handleRuntimeCompileProgressBroadcast = handleRuntimeCompileProgressBroadcast;
    window.handleRuntimeCompileCompleteBroadcast = handleRuntimeCompileCompleteBroadcast;

    // { logon: true } steps run in the desktop logon dialog before the desktop starts (user
    // settings and application data, websocket.js _runLogonInitSteps); everything that builds
    // the desktop (start menu, desktop settings, icons, ...) runs in the startup window.
    // Priority 0.45: User global settings (startup behaviour, Atelier, etc.) from server config
    window.wsClient.registerInitStep(0.45, 'Loading user global settings', async () => {
        if (typeof loadUserGlobalSettingsFromServer === 'function') {
            const settings = await loadUserGlobalSettingsFromServer();
            // no server copy (an offline boot, #899): fail, so the step runs again when the server is back - the
            // desktop must not stay on defaults (Nov 19 2026)
            if (!settings && window.wsClient && window.wsClient._offlineBoot) throw new Error('user settings wait for the server');
        }
    }, true, { logon: true });

    // Priority 0.46: Start menu organizer's saved layout (order + folders) — fetchStartMenuCustomLayout: modalUtils.js
    window.wsClient.registerInitStep(0.46, 'Loading start menu layout', async () => {
        // Melaton Mobile has no Vista Start menu to lay out (#890); the organizer reads it if it opens there
        if (window.uiShell === 'mobile') return;
        if (typeof fetchStartMenuCustomLayout === 'function') {
            await fetchStartMenuCustomLayout();
        }
    }, true);

    // Priority 0.5: Load desktop settings early (desktop mode only) - before other initialization
    if (window.isDesktop) {
        window.wsClient.registerInitStep(0.5, 'Loading Desktop Settings', async () => {
            try {
                if (window.wsClient && window.wsClient.isConnected()) {
                    const settings = await window.wsClient.getDesktopSettings();

                    if (settings) {
                        // Suppress wallpaper image transition until loadWorkspaces finishes
                        document.body.classList.add('wallpaper-boot');

                        // applyEarlyWorkspaceThemeInline: public/scripts/comp/workspaceUtils.js
                        applyEarlyWorkspaceThemeInline(settings);

                        // applyWorkspaceCssFromServer: public/scripts/comp/workspaceUtils.js
                        // Swap workspaces.css to the live hash before later boot strips
                        // inline vars. Baked app.html ?sha= can still be the old wallpaper.
                        if (settings.workspaceCssHash) {
                            await applyWorkspaceCssFromServer(settings.workspaceCssHash, '/css/workspaces.css', { skipTheme: true });
                        }
                    }
                }
            } catch (error) {
                console.warn('⚠️ Failed to load desktop settings early:', error);
                // Non-critical, continue initialization
            }
        });
    }

    // Priority 1: Initialize main app components
    window.wsClient.registerInitStep(1, 'Loading Application Data', async () => {
        try {
            await loadOptions();
        } catch (error) {
            if (error && error.code === 'ACCOUNT_DATA_CANCELLED') {
                return;
            }
            console.error('❌ Critical: Failed to load application data:', error);

            // Desktop: the logon dialog owns this failure (Retry / Restart there, websocket.js
            // _runLogonInitSteps); the desktop does not start without application data
            if (window.wsClient && typeof window.wsClient.isLogonInitPhase === 'function' && window.wsClient.isLogonInitPhase()) {
                throw error;
            }
            // an offline boot (#899): no box; the step runs again when the Nightshade Network is back
            if (window.wsClient && window.wsClient._offlineBoot && !window.wsClient.initializationCompleted) {
                throw error;
            }

            const confirmed = await showConfirmationDialog(
                'Failed to load application data. This may be due to a server issue or connection problem.',
                [
                    { text: 'Retry', value: 'retry', className: 'btn-primary' },
                    { text: 'Restart', value: 'refresh', className: 'btn-secondary' }
                ],
                null,
                { title: 'Critical Error', icon: 'fas fa-triangle-exclamation' }
            );

            if (confirmed === 'retry') {
                // Retry loading options
                await loadOptions();
            } else if (confirmed === 'refresh') {
                // Restart: a cold boot from the home URL (restartClientNavigate), never a reload of /app
                if (typeof window.restartClientNavigate === 'function') window.restartClientNavigate();
                else window.location.replace((window.melatonHomeUrl ? window.melatonHomeUrl() : '/launch'));
                return; // Don't continue with initialization
            }
        }
    }, true, { logon: true, critical: true, failureText: 'Melaton could not load your application data.' });

    // The phone (WM shell) boots to Today, which needs neither the whole gallery list (16,915 items,
    // ~15 MB on the A53) nor the prompt tokenizers (~6 MB): those load in the background once Today is
    // up (wmShell 'wmBootDone'), when the phone is idle. Desktop boots are unchanged.
    const phoneShell = () => window.uiShell === 'mobile';
    function afterPhoneBoot(fn) {
        const run = () => {
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout: 3000 });
            else setTimeout(fn, 500);
        };
        if (document.documentElement.dataset.wmBoot === 'done') run();
        else document.addEventListener('wmBootDone', run, { once: true });
    }

    async function loadPromptTokenizers() {
        // Melaton Mobile (#890): only the open model's tokenizer. Both stayed for the life of the page
        // after the first Studio open (Qwen's tables ~65 MB of heap, T5 ~10 MB) although a phone writes
        // for one model at a time; the other loads the first time something asks for it
        // (ensurePromptTokenizerForModel, utilities.js: Qwen and T5 alike).
        if (phoneShell()) {
            const model = typeof getCurrentSelectedModel === 'function' ? getCurrentSelectedModel() : 'v5';
            try {
                return !!(await ensurePromptTokenizerForModel(model || 'v5'));
            } catch (error) {
                console.error('❌ Failed to load the prompt tokenizer:', error);
                return false;
            }
        }
        // ensurePromptTokenizerForModel: public/scripts/comp/utilities.js
        // V5 (boot default) uses Qwen; start it while T5 JSON loads so the toolbar has a tokenizer.
        const qwenReady = ensurePromptTokenizerForModel('v5');
        // T5: published only once loaded; null when it could not load (logged there)
        const t5Ok = !!(await ensurePromptTokenizerForModel(null, 't5'));
        if (t5Ok) console.log('✅ T5 Tokenizer loaded successfully');

        try {
            await qwenReady;
        } catch (error) {
            console.error('❌ Failed to load Qwen tokenizer:', error);
        }

        return t5Ok;
    }

    // The desktop too (#817): this step held every boot for the tokenizers (1.7 s of the boot in
    // the headless profile: ~6 MB fetched and parsed, the Qwen tables built on the page's thread)
    // although only Studio's token counts read them, and those take a missing tokenizer (T5
    // readers check for it, Qwen readers await ensurePromptTokenizerForModel, which loads on demand).
    // They load once the desktop is up (desktopBoot's 'desktopBootDone') and the page is idle; a
    // page with no desktop boot (app mode) loads them after the init steps. Once per page: the
    // step runs again on every reconnect and used to load both again.
    function afterDesktopBoot(fn) {
        let ran = false;
        const run = () => {
            if (ran) return;
            ran = true;
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout: 3000 });
            else setTimeout(fn, 500);
        };
        // getClientDesktopState: public/scripts/comp/desktopBoot.js
        const state = typeof window.getClientDesktopState === 'function' ? window.getClientDesktopState() : 'ready';
        if (state === 'desktop' || state === 'ready') { run(); return; }
        document.addEventListener('desktopBootDone', run, { once: true });
        // a boot that never reports (a lock or a fault dialog held it): still load them
        setTimeout(run, 60000);
    }

    // Steps Melaton Mobile runs after Today is up (websocket.js _deferInitStepOnPhone, #817): the
    // ones that only prepare Studio, its tool windows and its settings, and the two that wire the
    // desktop's menus and keys. Their order among themselves is kept. Not here: anything Today,
    // the phone's notifications or the server's view of the phone need (settings, workspaces,
    // gallery, Director, background services, Finalizing).
    window.wsClient.phoneDeferredInitSteps = new Set([
        'Configuring Studio',
        'Initializing emphasis groups tool', 'Initializing generation usage tool', 'Initializing Prompt Toolbar',
        'Loading SmartText settings', 'Initializing Image Bias System', 'Initializing Inpaint Editor',
        'Loading autofill ranking config', 'Initializing reference manager', 'Initializing stage results review',
        'Initializing Text Replacement Manager', 'Initializing Keyboard Shortcuts', 'Wiring Application UI',
        'Wiring Dynamic Generation UI', 'Request body replacements listener scope', 'Initializing Preset Manager',
        'Compile to Prompts', 'Manual modal listener scope', 'Manual preview manager', 'Studio quickstart gallery',
        'Character prompt listener scope', 'Character positions tool', 'Manual tab listener scope',
        'Manual generation params listener scope', 'Studio soft tips', 'Pipeline global toggle listener scope',
        'Metadata dialog listener scope', 'Random prompt listener scope', 'Director learning admin listener scope',
        'Manual resolution and dropdown listeners', 'Main prompt autocomplete listeners'
    ]);

    // The phone loads them when Studio first opens (#817): loaded 3 s after Today they built the Qwen
    // tables on the page's thread (over a second on the A53) just as the person starts tapping, and
    // only Studio and its tool windows read them (T5 readers take a missing one, Qwen readers load on
    // demand). wmShell's wmAppChange names the program that came to the front.
    function whenPhoneStudioOpens(fn) {
        const sh = window.wmShell;
        if (sh && typeof sh.currentApp === 'function' && sh.currentApp() === 'studio') { fn(); return; }
        const onApp = (e) => {
            if (!e.detail || e.detail.id !== 'studio') return;
            document.removeEventListener('wmAppChange', onApp);
            // after Studio's first frame
            requestAnimationFrame(() => setTimeout(fn, 0));
        };
        document.addEventListener('wmAppChange', onApp);
    }

    // the gate the on-demand Qwen load waits behind on the phone (utilities.js ensurePromptTokenizerForModel):
    // Studio's model dropdown and token bars ask for it while the phone boots
    if (phoneShell()) {
        window.melatonTokenizerGate = new Promise((resolve) => whenPhoneStudioOpens(() => { window.melatonTokenizerGate = null; resolve(); }));
    }

    let tokenizersQueued = false;
    window.wsClient.registerInitStep(5, 'Initializing Tokenizer', async () => {
        if (tokenizersQueued) return;
        tokenizersQueued = true;
        const load = () => {
            loadPromptTokenizers().then((ok) => {
                if (!ok) tokenizersQueued = false; // the next reconnect tries again
                document.dispatchEvent(new CustomEvent('promptTokenizersLoaded', { detail: { ok } }));
            }, () => { tokenizersQueued = false; });
        };
        if (phoneShell()) whenPhoneStudioOpens(load);
        else afterDesktopBoot(load);
    }, true);
    // The boot's own part and Studio's part are two steps (#844). They ran as one, so the phone could
    // not put Studio's half off and a boot without Studio's scripts stopped here. On the desktop
    // 'Configuring Studio' follows at once, as before; Melaton Mobile runs it after Today is up
    // (phoneDeferredInitSteps below).
    window.wsClient.registerInitStep(10, 'Configuring Application', async () => {
        updateBalanceDisplay(window.optionsData?.balance);
        galleryRows = calculateGalleryRows();
        const galleryToggleGroup = document.getElementById('galleryToggleGroup');
        galleryToggleGroup.setAttribute('data-active', currentGalleryView);
    });
    window.wsClient.registerInitStep(10.1, 'Configuring Studio', async () => {
        // Handle queue status
        if (window.optionsData?.queue_status === 2) {
            isQueueStopped = true;
            isQueueProcessing = false;
        } else if (window.optionsData?.queue_status === 1) {
            isQueueStopped = false;
            isQueueProcessing = true;
        } else {
            isQueueStopped = false;
            isQueueProcessing = false;
        }

        updateManualGenerateBtnState();
        generateSamplerOptions();
        generateResolutionOptions();
        generateModelOptions();
        generateNoiseSchedulerOptions();

        renderManualSamplerDropdown(manualSelectedSampler);
        renderManualResolutionDropdown(manualSelectedResolution);
        renderManualModelDropdown(manualSelectedModel);
        renderDatasetDropdown();

        selectManualSampler('k_euler_ancestral');
        selectManualResolution('normal_square', 'Normal');
        selectManualNoiseScheduler('karras');
        selectManualModel('v5', '', true);

        updateDatasetDisplay();
        updateSubTogglesButtonState();
        renderUcPresetsDropdown();
        selectUcPreset(3);
        setupUcDropdownContextMenu();
        setupDatasetDropdownContextMenu();
    });

    // The phone's Today before the whole list is in: the newest prints, kept apart from allImages (a
    // short allImages would be taken for an incremental sync base). Waits at most 3 s; Today then
    // fills in when the list arrives (wmShell redraws Today on galleryUpdated).
    const PHONE_GALLERY_HEAD = 24;
    async function loadPhoneGalleryHead() {
        if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length) return; // eslint-disable-line no-undef
        try {
            // loadGalleryChunk: public/scripts/comp/galleryView.js
            const head = await Promise.race([
                loadGalleryChunk('images', 0, PHONE_GALLERY_HEAD),
                new Promise((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            if (head && Array.isArray(head.chunk)) window.galleryHeadItems = head.chunk;
        } catch (error) {
            console.warn('Phone gallery head failed (the full list follows):', error);
        }
    }
    document.addEventListener('galleryUpdated', () => {
        if (typeof allImages !== 'undefined' && Array.isArray(allImages) && allImages.length) window.galleryHeadItems = null; // eslint-disable-line no-undef
    });

    // ---- The phone's copy of the gallery list (Yukimi, Nov 15: keep it across cold boots as long as
    // the gallery's hash matches). Every cold boot downloaded the whole list again (16,915 items,
    // ~15 MB on the A53). The list and its sync stamp (galleryImagesSyncState: total, last destructive
    // change, last update, newest file) are kept in IndexedDB after each complete load; after the next
    // boot they come back before the load, and the loader's own probe decides: the same gallery is
    // used as it is, a few new prints come as a head sync, a deletion anywhere means the full read.
    const GALLERY_COPY_DB = 'melatonGalleryCopy';
    const GALLERY_COPY_STORE = 'copy';
    function galleryCopyDb() {
        return new Promise((resolve, reject) => {
            const r = indexedDB.open(GALLERY_COPY_DB, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(GALLERY_COPY_STORE);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }
    function galleryCopyReq(db, mode, fn) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(GALLERY_COPY_STORE, mode);
            const req = fn(tx.objectStore(GALLERY_COPY_STORE));
            tx.oncomplete = () => resolve(req && req.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    async function restorePhoneGallery() {
        try {
            if (typeof allImages === 'undefined' || !Array.isArray(allImages) || allImages.length) return; // eslint-disable-line no-undef
            if (typeof indexedDB === 'undefined') return;
            const db = await galleryCopyDb();
            const rec = await galleryCopyReq(db, 'readonly', (st) => st.get('images'));
            db.close();
            const ws = typeof getGalleryLoadWorkspaceId === 'function' ? getGalleryLoadWorkspaceId() : 'default'; // eslint-disable-line no-undef
            if (!rec || rec.v !== 1 || rec.workspaceId !== ws || !Array.isArray(rec.list) || !rec.list.length || !rec.syncState) return;
            if (allImages.length) return; // eslint-disable-line no-undef
            for (let i = 0; i < rec.list.length; i += 2000) allImages.push(...rec.list.slice(i, i + 2000)); // eslint-disable-line no-undef
            galleryImagesSyncState = rec.syncState; // eslint-disable-line no-undef
            galleryCopyKey = galleryCopyKeyOf(rec.syncState, rec.list.length);
        } catch (error) {
            console.warn('Phone gallery copy not restored:', error && error.message);
        }
    }
    let galleryCopyTimer = null;
    let galleryCopyKey = '';
    const galleryCopyKeyOf = (st, n) => JSON.stringify([st && st.workspaceId, st && st.total, st && st.destructiveAt, st && st.updatedAt, st && st.latestFilename, n]);
    // The copy is written when the page goes behind (screen off, another app, Home): one write of the
    // whole list blocks the A53's page 155-170 ms (the put clones 16,915 items), and it ran after every
    // gallery change - once per print batch during a Director turn (#843). Changes only mark it stale;
    // a phone with no copy yet still writes its first one soon after the load.
    let galleryCopyStale = false;
    function savePhoneGalleryNow() {
        if (!galleryCopyStale) return;
        galleryCopyStale = false;
        clearTimeout(galleryCopyTimer);
        void savePhoneGalleryRun();
    }
    function notePhoneGalleryChanged() {
        galleryCopyStale = true;
        if (!galleryCopyKey) savePhoneGallerySoon();
    }
    function savePhoneGallerySoon() {
        clearTimeout(galleryCopyTimer);
        galleryCopyTimer = setTimeout(() => {
            galleryCopyStale = false;
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => { void savePhoneGalleryRun(); }, { timeout: 20000 });
            else void savePhoneGalleryRun();
        }, 5000);
    }
    async function savePhoneGalleryRun() {
        try {
            const st = typeof galleryImagesSyncState !== 'undefined' ? galleryImagesSyncState : null; // eslint-disable-line no-undef
            const list = typeof allImages !== 'undefined' ? allImages : null; // eslint-disable-line no-undef
            if (!st || !Array.isArray(list) || !list.length || st.total !== list.length || typeof indexedDB === 'undefined') return;
            // the copy already kept is this one (a boot that used it): no second write
            const key = galleryCopyKeyOf(st, list.length);
            if (key === galleryCopyKey) return;
            galleryCopyKey = key;
            const db = await galleryCopyDb();
            await galleryCopyReq(db, 'readwrite', (store) => store.put({ v: 1, workspaceId: st.workspaceId, syncState: { ...st }, list: list.slice(), at: Date.now() }, 'images'));
            db.close();
        } catch (error) {
            console.warn('Phone gallery copy not saved:', error && error.message);
        }
    }
    if (phoneShell()) {
        document.addEventListener('galleryUpdated', notePhoneGalleryChanged);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePhoneGalleryNow(); });
        window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on === false) savePhoneGalleryNow(); });
    }

    // The DeX window of a hybrid phone (#890): the phone window keeps its copy of the gallery list in
    // IndexedDB (melatonGalleryCopy, same origin and the same app), and the DeX window read the whole list
    // from the server again on every boot (16,915 items, ~15 MB). It starts from that copy too; the
    // loader's probe decides as on the phone (the same gallery used as it is, a head sync, or the full
    // read). Only the phone window writes the copy.
    function dexWindowNow() {
        const mc = window.melatonContinuity;
        try { return !!(mc && typeof mc.isDexWindow === 'function' && mc.isDexWindow()); } catch (_) { return false; }
    }

    // public/scripts/comp/galleryView.js loadGallery, shouldAutoLaunchWorkspace
    // options.restoreCopy: the phone's copy of the list first (restorePhoneGallery), once the window is open
    function beginStartupGalleryLoad(options) {
        if (window.isEditorStandaloneWindow) {
            return Promise.resolve();
        }
        const restoreCopy = !!(options && options.restoreCopy);

        const autoLaunchWorkspace = typeof shouldAutoLaunchWorkspace === 'function'
            ? shouldAutoLaunchWorkspace()
            : true;

        return (async () => {
            if (window.isDesktop && autoLaunchWorkspace) {
                const galleryWindow = document.getElementById('galleryWindow');
                if (galleryWindow && typeof openModal === 'function') {
                    openModal(galleryWindow);
                } else if (galleryWindow) {
                    galleryWindow.classList.remove('hidden');
                }
                // applyDesktopWindowPositionsAfterLoad: public/scripts/comp/modalUtils.js
                if (typeof applyDesktopWindowPositionsAfterLoad === 'function') {
                    applyDesktopWindowPositionsAfterLoad();
                }
            }
            // bootUiDebug.gate: public/scripts/comp/bootUiDebug.js
            if (bootUiDebug) {
                await bootUiDebug.gate('gallery', { detail: 'Loading Gallery' });
            }
            if (restoreCopy) await restorePhoneGallery();
            await loadGallery(false, null, {
                showProgress: true,
                startupBoot: true
            });
            await updateGalleryGrid(true, true);
            if (bootUiDebug) {
                bootUiDebug.markGalleryReady();
            }
        })().catch((err) => {
            console.error('Startup gallery load failed:', err);
            // bootUiDebug.markGalleryReady: public/scripts/comp/bootUiDebug.js
            if (bootUiDebug) {
                bootUiDebug.markGalleryReady();
            }
        });
    }

    window.wsClient.registerInitStep(84, 'Starting Background Services', async () => {
        // wireSystemTrayListeners: public/scripts/comp/systemTrayManager.js
        await wireSystemTrayListeners();
    }, true);

    window.wsClient.registerInitStep(85, 'Wiring Application UI', async () => {
        // Listeners: comp init steps 47.45–47.8 (pipeline, api key, metadata, autocomplete, random prompt, director)

        wireMainMenuListeners();

        initializeSessionValidation();

        await initializeEmphasisOverlay(manualPrompt);
        await initializeEmphasisOverlay(manualUc);
        const manualPromptNegativeInit = document.getElementById('manualPromptNegative');
        if (manualPromptNegativeInit) {
            await initializeEmphasisOverlay(manualPromptNegativeInit);
        }

        await updateMenuBarHeight();

        // setupNovelContextMenu: public/scripts/comp/novelContextMenu.js
        if (typeof setupNovelContextMenu === 'function') {
            setupNovelContextMenu();
        }
    });

    window.wsClient.registerInitStep(31, 'Loading Gallery', async () => {
        if (window.isEditorStandaloneWindow) {
            return;
        }
        if (window.isDesktop) {
            // Fire-and-forget: startup splash and init do not wait; galleryView shows its own progress toast
            beginStartupGalleryLoad({ restoreCopy: dexWindowNow() });
            return;
        }
        if (phoneShell()) {
            // Today shows only the newest prints (wmShell newestPrints, wmTodayWidgets lastPrint): one
            // small read for those now (galleryHeadItems), the whole list after Today is up - from the
            // phone's own copy when the server's gallery still matches it (restorePhoneGallery)
            await loadPhoneGalleryHead();
            afterPhoneBoot(async () => { await restorePhoneGallery(); void beginStartupGalleryLoad(); });
            return;
        }
        await beginStartupGalleryLoad();
    }, true, window.isDesktop ? { nonBlocking: true } : undefined);

    // app.html raises the resource timing buffer to 2,000 entries so a boot's ~600 requests can all be
    // read back (boot reports, the A53 measurements). Those entries then stayed for the life of the
    // page and the buffer kept filling to its 2,000. Five minutes after the boot they are let go
    // and the buffer returns to the browser's own size; observers (wmShell's data arrows) get new
    // entries either way (#849).
    setTimeout(() => {
        try { performance.clearResourceTimings(); performance.setResourceTimingBufferSize(250); } catch (_) { /* no resource timing */ }
    }, 5 * 60 * 1000);

    window.wsClient.registerInitStep(100, 'Finalizing', async () => {
        // Activate the Android notification bridge now that all scripts have loaded.
        // This must run last so that window.AndroidNotification (injected by the host)
        // and all toast functions are fully available before we check isReady().
        if (typeof window.initAndroidNotificationBridge === 'function') {
            window.initAndroidNotificationBridge();
        }
        registerAndroidBackgroundNotificationManifest();
    });
}
