/**
 * Standalone /editor entry: same document shell as the main app, editor-focused surface.
 */
(function () {
    let desktopOverrideResizeTimer = null;

    function lockEditorDesktopOverride() {
        window.isDesktop = false;
        document.body.classList.remove('desktop-mode');
        document.body.classList.remove('windows-startup');
        const taskbar = document.getElementById('desktopTaskbar');
        if (taskbar) {
            taskbar.classList.add('hidden');
        }
    }

    function applyEditorStandaloneLayout() {
        document.body.classList.add('editor-standalone');
        document.body.classList.add('editor-open');
        lockEditorDesktopOverride();

        const galleryWindow = document.getElementById('galleryWindow');
        if (galleryWindow) {
            galleryWindow.classList.add('hidden');
        }
        const titlebar = document.getElementById('titlebar-grab-area-container');
        if (titlebar) {
            titlebar.classList.add('hidden');
        }
        const taskbar = document.getElementById('desktopTaskbar');
        if (taskbar) {
            taskbar.classList.add('hidden');
        }
    }

    function scheduleDesktopOverrideOnResize() {
        if (desktopOverrideResizeTimer) {
            clearTimeout(desktopOverrideResizeTimer);
        }
        desktopOverrideResizeTimer = setTimeout(function () {
            desktopOverrideResizeTimer = null;
            lockEditorDesktopOverride();
        }, 150);
    }

    function openEditorSurface() {
        if (typeof openManualModalWithContent === 'function') {
            openManualModalWithContent();
        }
    }

    function run() {
        applyEditorStandaloneLayout();
        window.addEventListener('resize', scheduleDesktopOverrideOnResize, { passive: true });
        requestAnimationFrame(function () {
            openEditorSurface();
            lockEditorDesktopOverride();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
