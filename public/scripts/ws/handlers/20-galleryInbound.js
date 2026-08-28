// Gallery inbound WebSocket handlers — gallery_updated.
// registerWsInboundHandler: public/scripts/ws/wsInboundRegistry.js

function galleryItemIdentityKey(img) {
    if (!img) return null;
    return img.original || img.filename || img.upscaled || null;
}

function detectGalleryChanges(oldImages, newImages) {
    if (!oldImages || !newImages) {
        return { type: 'full_reload' };
    }

    if (Math.abs(oldImages.length - newImages.length) > 10) {
        return { type: 'full_reload' };
    }

    if (oldImages.length > 0 && newImages.length > 0) {
        const oldFirstKey = galleryItemIdentityKey(oldImages[0]);
        const newFirstKey = galleryItemIdentityKey(newImages[0]);

        if (oldFirstKey && newFirstKey && oldFirstKey !== newFirstKey) {
            const oldFirstIndex = newImages.findIndex((img) => galleryItemIdentityKey(img) === oldFirstKey);
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
        // Confirm old list is a contiguous tail of the new list (true head prepend)
        let tailAligns = oldImages.length === 0;
        if (!tailAligns) {
            tailAligns = true;
            for (let i = 0; i < oldImages.length; i++) {
                if (galleryItemIdentityKey(oldImages[i]) !== galleryItemIdentityKey(newImages[i + addedCount])) {
                    tailAligns = false;
                    break;
                }
            }
        }
        if (tailAligns) {
            return {
                type: 'append_top',
                newItems: newImages.slice(0, addedCount)
            };
        }
    }

    if (oldImages.length !== newImages.length) {
        return { type: 'full_reload' };
    }

    for (let i = 0; i < oldImages.length; i++) {
        if (galleryItemIdentityKey(oldImages[i]) !== galleryItemIdentityKey(newImages[i])) {
            return { type: 'full_reload' };
        }
    }

    return { type: 'no_change' };
}

function appendNewGalleryItems(newItems) {
    if (!newItems || newItems.length === 0) return;

    // galleryRerollOwnsGalleryDom: public/scripts/comp/galleryView.js
    if (galleryRerollOwnsGalleryDom()) return;

    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // isGalleryWindowHidden: public/scripts/comp/galleryView.js
    if (isGalleryWindowHidden()) return;

    // findGalleryDomItemByIdentity / updateGalleryItemElementFromData: public/scripts/comp/galleryView.js
    // Upscale upgrades an existing base tile; true duplicates are skipped after update.
    const itemsToInsert = [];
    for (let i = 0; i < newItems.length; i++) {
        const imageData = newItems[i];
        const existingDom = findGalleryDomItemByIdentity(imageData);
        if (existingDom) {
            updateGalleryItemElementFromData(existingDom, imageData);
            if (!isGalleryScrolledFromHead() && gallery.children[0] !== existingDom) {
                gallery.insertBefore(existingDom, gallery.children[0]);
            }
            continue;
        }
        itemsToInsert.push(imageData);
    }

    if (itemsToInsert.length === 0) {
        reindexGallery();
        return;
    }

    // isGalleryScrolledFromHead, offsetGalleryItemIndexes: public/scripts/comp/galleryView.js
    if (isGalleryScrolledFromHead()) {
        offsetGalleryItemIndexes(itemsToInsert.length);
        return;
    }

    for (let i = itemsToInsert.length - 1; i >= 0; i--) {
        const imageData = itemsToInsert[i];
        const newItem = createGalleryItem(imageData, i, true);
        newItem.classList.add('gallery-placeholder', 'fade-in');
        gallery.insertBefore(newItem, gallery.children[0]);

        newItem.addEventListener('animationend', function handler() {
            newItem.classList.remove('fade-in');
            newItem.classList.remove('gallery-placeholder');
            if (!galleryItemHasImageWork(newItem)) {
                addImgToGalleryItemAsync(newItem, imageData);
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

    // offsetGalleryItemIndexes / isGalleryScrolledFromHead: public/scripts/comp/galleryView.js
    if (isGalleryScrolledFromHead()) {
        offsetGalleryItemIndexes(shiftAmount);
        return;
    }

    // At head: show the new list from index 0 (same end state as a cheap top redisplay)
    resetInfiniteScroll();
    displayCurrentPageOptimized();
}

function applyGalleryRemovalByFilenames(filenames) {
    if (!Array.isArray(filenames) || filenames.length === 0) {
        return;
    }

    const imagesToRemove = filenames
        .map(fn => findImageByFilename(fn))
        .filter(Boolean);

    if (imagesToRemove.length === 0) {
        return;
    }

    removeMultipleImagesFromGallery(imagesToRemove);
    driftGalleryImagesSyncState(allImages.length);
    syncServiceWorkerImageCacheRules();
}

function handleGalleryActionUpdate(data) {
    if (data.action === 'unupscaled_removed') {
        applyUnupscaledOriginalRemoved(data.originalFilename, data.upscaledFilename);
        return;
    }

    const currentView = currentGalleryView || 'images';
    if (data.viewType && data.viewType !== currentView) {
        return;
    }

    if (data.action === 'bulk_delete' || data.action === 'bulk_sequenzia') {
        const filenames = Array.isArray(data.deletedFilenames) ? data.deletedFilenames : [];
        if (filenames.length === 0) {
            return;
        }

        if (isGalleryWindowHidden()) {
            const removeSet = new Set(filenames);
            const filtered = allImages.filter(img => {
                const candidates = [img.filename, img.original, img.upscaled].filter(Boolean);
                return !candidates.some(fn => removeSet.has(fn));
            });
            setActiveGalleryList(filtered);
            syncServiceWorkerImageCacheRules();
            return;
        }

        applyGalleryRemovalByFilenames(filenames);
        console.log(`Gallery: Applied ${data.action} for ${filenames.length} item(s)`);
        return;
    }

    if (data.action === 'bulk_preset_update') {
        galleryImagesSyncState = null;
        return;
    }

    if (data.action === 'append_top') {
        const newItems = Array.isArray(data.newItems) ? data.newItems : [];
        if (newItems.length === 0) {
            return;
        }

        // prependToActiveGalleryList: public/scripts/comp/galleryView.js — upserts (upscale upgrades same base)
        const changedItems = [];
        for (let i = newItems.length - 1; i >= 0; i--) {
            if (prependToActiveGalleryList(newItems[i])) {
                changedItems.unshift(newItems[i]);
            }
        }
        if (changedItems.length === 0) {
            return;
        }

        if (isGalleryWindowHidden()) {
            syncServiceWorkerImageCacheRules();
            return;
        }

        syncServiceWorkerImageCacheRules();
        if (sortGalleryData) {
            sortGalleryData();
        }
        triggerBuildGalleryNavigationCache();
        appendNewGalleryItems(changedItems);
        console.log(`Gallery: Appended/updated ${changedItems.length} item(s) via action`);
        return;
    }

    if (data.action === 'invalidate_sync') {
        galleryImagesSyncState = null;
        return;
    }

    console.warn('Gallery action update not handled:', data.action);
}

async function handleGalleryUpdatedData(data) {
    // isGalleryWindowHidden, setActiveGalleryList: public/scripts/comp/galleryView.js
    if (isGalleryWindowHidden()) {
        if (data.gallery) {
            setActiveGalleryList(data.gallery);
            syncServiceWorkerImageCacheRules();
        } else if (data.action) {
            handleGalleryActionUpdate(data);
        }
        return;
    }

    // galleryRerollOwnsGalleryDom: public/scripts/comp/galleryView.js
    if (galleryRerollOwnsGalleryDom()) {
        if (data.gallery) {
            setActiveGalleryList(data.gallery);
            syncServiceWorkerImageCacheRules();
            if (sortGalleryData) {
                sortGalleryData();
            }
            triggerBuildGalleryNavigationCache();
        }
        return;
    }

    if (window.skipNextGalleryRefresh && window.skipNextGalleryRefresh > 0) {
        window.skipNextGalleryRefresh--;
        return;
    }

    if (data.action && !data.gallery) {
        handleGalleryActionUpdate(data);
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
            // applyGalleryListReload: public/scripts/comp/galleryView.js — keeps viewport when scrolled
            const mode = applyGalleryListReload(newImages);
            console.log(`Gallery: Full reload performed (${mode})`);
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

registerWsInboundHandler({
    id: 'gallery.replicationResponse',
    type: 'request_gallery_response',
    phase: 'post',
    handler(message) {
        const data = message.data || {};
        if (typeof applyGalleryReplicationResponse === 'function') {
            applyGalleryReplicationResponse(data);
        }
    }
});
