/** Main layout resize / orientation handlers (Phase 2 batch 13). */
let mainResizeTimeout;
function activateMainResizeListeners() {
    console.log('🚀 Activating main resize listeners');

    window.addEventListener('resize', () => {
        if (mainResizeTimeout) clearTimeout(mainResizeTimeout);
        mainResizeTimeout = setTimeout(resizeHandler, 250);
    });

    window.addEventListener('orientationchange', () => {
        if (mainResizeTimeout) clearTimeout(mainResizeTimeout);
        mainResizeTimeout = setTimeout(resizeHandler, 500);
    });

    // Initial check for current resolution
    resizeHandler();
}

function resizeHandler() {
    // Update batch size and trigger distances for new viewport
    imagesPerPage = calculateDynamicBatchSize();
    updateMenuBarHeight();

    if (!isGalleryWindowHidden()) {
        // Recalculate infinite scrolling layout if needed
        updateGalleryGrid(true, true); // onlyIfChanged=true, updatePlaceholders=true

        // Update preview container sizing if there's a loaded image
        sizeManualPreviewContainer();
    }
    updateAutocompletePositions();
}

