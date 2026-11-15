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
            await loadUserGlobalSettingsFromServer();
        }
    }, true, { logon: true });

    // Priority 0.46: Start menu organizer's saved layout (order + folders) — fetchStartMenuCustomLayout: modalUtils.js
    window.wsClient.registerInitStep(0.46, 'Loading start menu layout', async () => {
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
        // ensurePromptTokenizerForModel: public/scripts/comp/utilities.js
        // V5 (boot default) uses Qwen; start it while T5 JSON loads so the toolbar has a tokenizer.
        const qwenReady = ensurePromptTokenizerForModel('v5');
        let t5Ok = false;
        try {
            // published only once loaded: while it loads in the background (phone) a reader sees none
            const tokenizer = new T5Tokenizer();

            // Load tokenizer configuration from protected folder
            const response = await fetch('/protected/t5_tokenizer.json');
            const config = await response.json();
            await tokenizer.loadFromJSON(config);
            t5Tokenizer = tokenizer;

            console.log('✅ T5 Tokenizer loaded successfully');
            t5Ok = true;
        } catch (error) {
            console.error('❌ Failed to load T5 tokenizer:', error);
        }

        try {
            await qwenReady;
        } catch (error) {
            console.error('❌ Failed to load Qwen tokenizer:', error);
        }

        return t5Ok;
    }

    let phoneTokenizersQueued = false;
    window.wsClient.registerInitStep(5, 'Initializing Tokenizer', async () => {
        if (phoneShell()) {
            if (phoneTokenizersQueued) return;
            phoneTokenizersQueued = true;
            afterPhoneBoot(() => { void loadPromptTokenizers(); });
            return;
        }
        return loadPromptTokenizers();
    }, true);
    window.wsClient.registerInitStep(10, 'Configuring Application', async () => {
        updateBalanceDisplay(window.optionsData?.balance);
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

        galleryRows = calculateGalleryRows();
        const galleryToggleGroup = document.getElementById('galleryToggleGroup');
        galleryToggleGroup.setAttribute('data-active', currentGalleryView);
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

    // public/scripts/comp/galleryView.js loadGallery, shouldAutoLaunchWorkspace
    function beginStartupGalleryLoad() {
        if (window.isEditorStandaloneWindow) {
            return Promise.resolve();
        }

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
            beginStartupGalleryLoad();
            return;
        }
        if (phoneShell()) {
            // Today shows only the newest prints (wmShell newestPrints, wmTodayWidgets lastPrint): one
            // small read for those now (galleryHeadItems), the whole list after Today is up
            await loadPhoneGalleryHead();
            afterPhoneBoot(() => { void beginStartupGalleryLoad(); });
            return;
        }
        await beginStartupGalleryLoad();
    }, true, window.isDesktop ? { nonBlocking: true } : undefined);

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
