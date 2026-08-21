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

    // Priority 0.45: User global settings (startup behaviour, Atelier, etc.) from server config
    window.wsClient.registerInitStep(0.45, 'Loading user global settings', async () => {
        if (typeof loadUserGlobalSettingsFromServer === 'function') {
            await loadUserGlobalSettingsFromServer();
        }
    }, true);

    // Priority 0.5: Load desktop settings early (desktop mode only) - before other initialization
    if (window.isDesktop) {
        window.wsClient.registerInitStep(0.5, 'Loading Desktop Settings', async () => {
            try {
                if (window.wsClient && window.wsClient.isConnected()) {
                    const settings = await window.wsClient.getDesktopSettings();

                    if (settings) {
                        const { wallpaper, wallpaperPosition, color, backgroundColor, workspaceId } = settings;

                        // Suppress wallpaper image transition until loadWorkspaces finishes
                        document.body.classList.add('wallpaper-boot');

                        // Set data-workspace before workspace list loads so [data-workspace=…]
                        // CSS matches the early wallpaper (avoids default wallpaper flash)
                        if (workspaceId) {
                            document.body.setAttribute('data-workspace', workspaceId);
                        }

                        // Apply colors
                        if (color) {
                            document.documentElement.style.setProperty('--workspace-color', color);
                        }

                        // Set background color to workspace color if no background is set
                        const bgColor = backgroundColor || color;
                        if (bgColor) {
                            document.documentElement.style.setProperty('--workspace-background-color', bgColor);
                        }

                        // Apply wallpaper if present
                        if (wallpaper && window.isDesktop) {
                            let wallpaperUrl = null;
                            const [type, ...idParts] = wallpaper.split(':');
                            const id = idParts.join(':');

                            switch (type) {
                                case 'file':
                                    wallpaperUrl = localGalleryImageUrl(id);
                                    break;
                                case 'cache':
                                    wallpaperUrl = localCacheUploadUrl(id);
                                    break;
                                case 'cache-preview':
                                    wallpaperUrl = localCachePreviewUrl(id);
                                    break;
                                case 'vibe':
                                    wallpaperUrl = `/cache/vibe/${id}`;
                                    break;
                                case 'wallpaper':
                                    wallpaperUrl = localCacheWallpaperUrl(id);
                                    break;
                                case 'url':
                                    wallpaperUrl = id;
                                    break;
                            }

                            if (wallpaperUrl) {
                                const position = wallpaperPosition || 'center';
                                // formatCssUrl: public/scripts/comp/workspaceUtils.js
                                const wallpaperCss = formatCssUrl(wallpaperUrl);
                                // Set on body (not only html) so inherited vars beat a mismatched
                                // [data-workspace] rule if theme attribute is still wrong briefly
                                document.documentElement.style.setProperty('--desktop-wallpaper', wallpaperCss);
                                document.documentElement.style.setProperty('--desktop-wallpaper-position', position);
                                document.body.style.setProperty('--desktop-wallpaper', wallpaperCss);
                                document.body.style.setProperty('--desktop-wallpaper-position', position);

                                // Preload the wallpaper image
                                const img = new Image();
                                img.src = wallpaperUrl;
                            }
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
                // Refresh the page
                window.location.reload();
                return; // Don't continue with initialization
            }
        }
    }, true);

    window.wsClient.registerInitStep(5, 'Initializing Tokenizer', async () => {
        try {
            t5Tokenizer = new T5Tokenizer();

            // Load tokenizer configuration from protected folder
            const response = await fetch('/protected/t5_tokenizer.json');
            const config = await response.json();
            await t5Tokenizer.loadFromJSON(config);

            console.log('✅ T5 Tokenizer loaded successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to load T5 tokenizer:', error);
            return false;
        }
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
        selectManualModel('v4_5', '', true);

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
            await loadGallery(false, null, {
                showProgress: true,
                startupBoot: true
            });
            await updateGalleryGrid(true, true);
        })().catch((err) => {
            console.error('Startup gallery load failed:', err);
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
