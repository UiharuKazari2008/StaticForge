// Gallery inbound WebSocket handlers — gallery_updated.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function detectGalleryChanges(oldImages, newImages) {
    if (!oldImages || !newImages) {
        return { type: 'full_reload' };
    }

    if (Math.abs(oldImages.length - newImages.length) > 10) {
        return { type: 'full_reload' };
    }

    if (oldImages.length > 0 && newImages.length > 0) {
        const oldFirst = oldImages[0];
        const newFirst = newImages[0];

        if (oldFirst.original !== newFirst.original) {
            const oldFirstIndex = newImages.findIndex(img => img.original === oldFirst.original);
            if (oldFirstIndex > 0) {
                return {
                    type: 'shift_indexes',
                    shiftAmount: oldFirstIndex
                };
            }
        }
    }

    if (newImages.length > oldImages.length) {
        const addedCount = newImages.length - oldImages.length;
        const addedItems = newImages.slice(0, addedCount);

        const existingOriginals = new Set(oldImages.map(img => img.original));
        const allAddedAreNew = addedItems.every(img => !existingOriginals.has(img.original));

        if (allAddedAreNew) {
            return {
                type: 'append_top',
                newItems: addedItems
            };
        }
    }

    if (oldImages.length !== newImages.length) {
        return { type: 'full_reload' };
    }

    for (let i = 0; i < oldImages.length; i++) {
        if (oldImages[i].original !== newImages[i].original) {
            return { type: 'full_reload' };
        }
    }

    return { type: 'no_change' };
}

function appendNewGalleryItems(newItems) {
    if (!newItems || newItems.length === 0) return;

    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // isGalleryWindowHidden: public/scripts/comp/galleryView.js
    if (isGalleryWindowHidden()) return;

    for (let i = newItems.length - 1; i >= 0; i--) {
        const newItem = createGalleryItem(newItems[i], i, true);
        newItem.classList.add('gallery-placeholder', 'fade-in');
        gallery.insertBefore(newItem, gallery.children[0]);

        newItem.addEventListener('animationend', function handler() {
            newItem.classList.remove('fade-in');
            newItem.classList.remove('gallery-placeholder');
            if (!newItem.querySelector('img')) {
                addImgToGalleryItemAsync(newItem, newItems[i]);
            }
            newItem.classList.add('slide-in');
            newItem.addEventListener('animationend', function slideHandler() {
                newItem.classList.remove('slide-in');
                newItem.removeEventListener('animationend', slideHandler);
            });
            newItem.removeEventListener('animationend', handler);
        });
    }

    reindexGallery();
}

function shiftGalleryIndexes(shiftAmount) {
    if (!shiftAmount || shiftAmount <= 0) return;

    for (let i = 0; i < shiftAmount; i++) {
        const placeholderItem = document.createElement('div');
        placeholderItem.className = 'gallery-item gallery-placeholder';
        placeholderItem.dataset.index = i.toString();
        placeholderItem.dataset.filename = 'placeholder';
        gallery.insertBefore(placeholderItem, gallery.children[0]);
    }

    reindexGallery();
    resetInfiniteScroll();
    displayCurrentPageOptimized();
}

async function handleGalleryUpdatedData(data) {
    // isGalleryWindowHidden, setActiveGalleryList: public/scripts/comp/galleryView.js
    if (isGalleryWindowHidden()) {
        if (data.gallery) {
            setActiveGalleryList(data.gallery);
            syncServiceWorkerImageCacheRules();
        }
        return;
    }

    if (window.skipNextGalleryRefresh && window.skipNextGalleryRefresh > 0) {
        window.skipNextGalleryRefresh--;
        return;
    }

    if (data.viewType && data.gallery) {
        const oldImages = allImages;
        const newImages = data.gallery;
        const currentView = currentGalleryView || 'images';

        if (data.viewType !== currentView) {
            console.warn('Gallery updated event received but view type does not match');
            return;
        }

        const changes = detectGalleryChanges(oldImages, newImages);

        if (changes.type === 'full_reload') {
            setActiveGalleryList(newImages);
            syncServiceWorkerImageCacheRules();
            if (sortGalleryData) {
                sortGalleryData();
            }
            triggerBuildGalleryNavigationCache();
            clearSelection();
            resetInfiniteScroll();
            displayCurrentPageOptimized();
            console.log('Gallery: Full reload performed');
        } else if (changes.type === 'append_top') {
            setActiveGalleryList(newImages);
            syncServiceWorkerImageCacheRules();
            if (sortGalleryData) {
                sortGalleryData();
            }
            triggerBuildGalleryNavigationCache();
            appendNewGalleryItems(changes.newItems);
            console.log(`Gallery: Appended ${changes.newItems.length} new items to top`);
        } else if (changes.type === 'shift_indexes') {
            setActiveGalleryList(newImages);
            syncServiceWorkerImageCacheRules();
            if (sortGalleryData) {
                sortGalleryData();
            }
            triggerBuildGalleryNavigationCache();
            shiftGalleryIndexes(changes.shiftAmount);
            console.log(`Gallery: Shifted indexes by ${changes.shiftAmount}`);
        } else {
            console.log('Gallery: No changes detected');
        }
    } else {
        console.warn('Gallery updated event received but data is missing or invalid:', data);
    }
}

registerWsInboundHandler({
    id: 'gallery.updated',
    type: 'gallery_updated',
    phase: 'only',
    handler(message) {
        handleGalleryUpdatedData(message.data);
    }
});
