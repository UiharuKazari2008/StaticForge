// Modal utility functions
const backdrop = document.querySelector('.modal-backdrop');

// Modal z-index management
const MODAL_Z_BASE = 1001; // Base z-index for modal stacking (above --z-modal = 1100)
const MODAL_Z_INCREMENT = 10; // Increment between modal layers
let modalStack = []; // Array to track modal stack order

function initializeModalDragging() {
    // Add drag functionality to all modal title bars
    document.addEventListener('mousedown', handleModalInteraction);
    document.addEventListener('mousemove', handleModalInteraction);
    document.addEventListener('mouseup', handleModalInteractionEnd);
}

function handleModalInteraction(e) {
    if (e.type === 'mousedown') {
        handleModalDragStart(e) || handleModalResizeStart(e);
    } else if (e.type === 'mousemove') {
        // Find any modal that's currently being dragged or resized
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const resizedModal = document.querySelector('.modal[data-resizing="true"]');

        if (draggedModal) {
            handleModalDrag(e, draggedModal);
        } else if (resizedModal) {
            handleModalResize(e, resizedModal);
        }
    }
}

function handleModalInteractionEnd(e) {
    // Find any modal that's currently being dragged or resized
    const draggedModal = document.querySelector('.modal[data-dragging="true"]');
    const resizedModal = document.querySelector('.modal[data-resizing="true"]');

    if (draggedModal) {
        handleModalDragEnd(e, draggedModal);
    } else if (resizedModal) {
        handleModalResizeEnd(e, resizedModal);
    }
}

function handleModalDragStart(e) {
    // Check if clicked element is a modal title bar
    const titleBar = e.target.closest('.modal-window-title');
    if (!titleBar) return;

    const modal = titleBar.closest('.modal');
    if (!modal) return;

    // Prevent dragging if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return;
    }

    e.preventDefault();

    // Store drag state as data attributes on the modal
    modal.setAttribute('data-dragging', 'true');
    modal.setAttribute('data-drag-start-x', e.clientX);
    modal.setAttribute('data-drag-start-y', e.clientY);

    // Get current offset values and store them
    const computedStyle = getComputedStyle(modal);
    const modalStartOffsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const modalStartOffsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');

    modal.setAttribute('data-modal-start-offset-x', modalStartOffsetX);
    modal.setAttribute('data-modal-start-offset-y', modalStartOffsetY);

    // Add dragging class to title bar
    titleBar.classList.add('dragging');

    // Bring modal to front when dragging starts (only for moveable modals)
    const isManualModal = modal.id === 'manualModal';
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isManualModal;

    if (isMoveable) {
        bringModalToFront(modal);
    }

    // Check backdrop when starting drag (in case this was the only non-transient modal)
    updateBackdropVisibility();
}

function handleModalDrag(e, draggedModal) {
    if (!draggedModal) return;

    e.preventDefault();

    const dragStartX = parseFloat(draggedModal.getAttribute('data-drag-start-x'));
    const dragStartY = parseFloat(draggedModal.getAttribute('data-drag-start-y'));
    const modalStartOffsetX = parseFloat(draggedModal.getAttribute('data-modal-start-offset-x'));
    const modalStartOffsetY = parseFloat(draggedModal.getAttribute('data-modal-start-offset-y'));

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    let newOffsetX = modalStartOffsetX + deltaX;
    let newOffsetY = modalStartOffsetY + deltaY;

    // Mark modal as moved if it hasn't been moved before
    if (!draggedModal.hasAttribute('data-modal-moved')) {
        draggedModal.setAttribute('data-modal-moved', 'true');
        // Since modal was just moved, update backdrop state
        updateBackdropVisibility();
    }

    // Get modal dimensions
    const modalRect = draggedModal.getBoundingClientRect();
    const titleBar = draggedModal.querySelector('.modal-window-title');

    if (titleBar) {
        const titleRect = titleBar.getBoundingClientRect();

        // Calculate where the title bar would be positioned with the new offsets
        // Modal center will be at (window.innerWidth/2 + newOffsetX, window.innerHeight/2 + newOffsetY)
        // Title bar position relative to modal center
        const titleBarCenterX = (titleRect.left + titleRect.right) / 2 - modalRect.width / 2;
        const titleBarCenterY = (titleRect.top + titleRect.bottom) / 2 - modalRect.height / 2;

        // Ensure at least 85px of the modal stays visible on screen in all directions

        // Constrain offset values so modal never goes so far off screen that less than 85px remains visible
        // Modal left edge = window.innerWidth/2 + offsetX - modalRect.width/2
        // Modal right edge = window.innerWidth/2 + offsetX + modalRect.width/2
        // Modal top edge = window.innerHeight/2 + offsetY - modalRect.height/2
        // Modal bottom edge = window.innerHeight/2 + offsetY + modalRect.height/2

        // Left constraint: modal left edge >= -modalRect.width + 85 (85px visible from left)
        // window.innerWidth/2 + offsetX - modalRect.width/2 >= -modalRect.width + 85
        // offsetX >= -modalRect.width + 85 - window.innerWidth/2 + modalRect.width/2
        // offsetX >= -window.innerWidth/2 + 85
        const minOffsetX = -window.innerWidth / 2 + 85;

        // Right constraint: modal right edge <= window.innerWidth + modalRect.width - 85 (85px visible from right)
        // window.innerWidth/2 + offsetX + modalRect.width/2 <= window.innerWidth + modalRect.width - 85
        // offsetX <= window.innerWidth + modalRect.width - 85 - window.innerWidth/2 - modalRect.width/2
        // offsetX <= window.innerWidth/2 - 85 + modalRect.width
        const maxOffsetX = window.innerWidth / 2 - 85 + modalRect.width / 2;

        // Up constraint: ensure title bar stays visible (can't go completely off screen at top)
        // Title bar is at the top of the modal, so modal top edge should stay within viewport
        // window.innerHeight/2 + offsetY - modalRect.height/2 >= 0 (title bar visible)
        // offsetY >= -window.innerHeight/2 + modalRect.height/2
        const minOffsetY = -window.innerHeight / 2 + modalRect.height / 2;

        // Down constraint: modal bottom edge <= window.innerHeight + modalRect.height - 85 (85px visible from bottom)
        // window.innerHeight/2 + offsetY + modalRect.height/2 <= window.innerHeight + modalRect.height - 85
        // offsetY <= window.innerHeight + modalRect.height - 85 - window.innerHeight/2 - modalRect.height/2
        // offsetY <= window.innerHeight/2 - 85 + modalRect.height
        const maxOffsetY = window.innerHeight / 2 - 85 + modalRect.height / 2;

        newOffsetX = Math.max(minOffsetX, Math.min(maxOffsetX, newOffsetX));
        newOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, newOffsetY));
    }

    // Apply the new offsets
    draggedModal.style.setProperty('--modal-offset-x', `${newOffsetX}px`);
    draggedModal.style.setProperty('--modal-offset-y', `${newOffsetY}px`);
}

function handleModalDragEnd(e, draggedModal) {
    if (!draggedModal) return;

    const titleBar = draggedModal.querySelector('.modal-window-title');
    if (titleBar) {
        titleBar.classList.remove('dragging');
    }

    // Clear drag state data attributes
    draggedModal.removeAttribute('data-dragging');
    draggedModal.removeAttribute('data-drag-start-x');
    draggedModal.removeAttribute('data-drag-start-y');
    draggedModal.removeAttribute('data-modal-start-offset-x');
    draggedModal.removeAttribute('data-modal-start-offset-y');

    // Check backdrop when stopping drag
    updateBackdropVisibility();
}

function handleModalResizeStart(e) {
    // Check if clicked element is a resize handle
    const resizeHandle = e.target.closest('.resize-handle');
    if (!resizeHandle) return false;

    const modal = resizeHandle.closest('.modal');
    if (!modal) return false;

    // Prevent resizing if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return false;
    }

    e.preventDefault();

    // Store resize state as data attributes on the modal
    modal.setAttribute('data-resizing', 'true');
    modal.setAttribute('data-resize-start-x', e.clientX);
    modal.setAttribute('data-resize-start-y', e.clientY);

    // Get modal current dimensions and position and store them
    const modalRect = modal.getBoundingClientRect();
    modal.setAttribute('data-resize-start-width', modalRect.width);
    modal.setAttribute('data-resize-start-height', modalRect.height);
    modal.setAttribute('data-resize-start-left', modalRect.left);
    modal.setAttribute('data-resize-start-top', modalRect.top);

    // Determine resize direction from handle classes and store it
    let resizeDirection = '';
    if (resizeHandle.classList.contains('nw')) resizeDirection = 'nw';
    else if (resizeHandle.classList.contains('ne')) resizeDirection = 'ne';
    else if (resizeHandle.classList.contains('sw')) resizeDirection = 'sw';
    else if (resizeHandle.classList.contains('se')) resizeDirection = 'se';
    else if (resizeHandle.classList.contains('n')) resizeDirection = 'n';
    else if (resizeHandle.classList.contains('s')) resizeDirection = 's';
    else if (resizeHandle.classList.contains('w')) resizeDirection = 'w';
    else if (resizeHandle.classList.contains('e')) resizeDirection = 'e';

    modal.setAttribute('data-resize-direction', resizeDirection);

    // Bring modal to front when resizing starts (only for moveable modals)
    const isManualModal = modal.id === 'manualModal';
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isManualModal;

    if (isMoveable) {
        bringModalToFront(modal);
    }

    // Check backdrop when starting resize
    updateBackdropVisibility();

    return true;
}

function handleModalResize(e, resizedModal) {
    if (!resizedModal) return;

    e.preventDefault();

    const resizeStartX = parseFloat(resizedModal.getAttribute('data-resize-start-x'));
    const resizeStartY = parseFloat(resizedModal.getAttribute('data-resize-start-y'));
    const resizeStartWidth = parseFloat(resizedModal.getAttribute('data-resize-start-width'));
    const resizeStartHeight = parseFloat(resizedModal.getAttribute('data-resize-start-height'));
    const resizeStartLeft = parseFloat(resizedModal.getAttribute('data-resize-start-left'));
    const resizeStartTop = parseFloat(resizedModal.getAttribute('data-resize-start-top'));
    const resizeDirection = resizedModal.getAttribute('data-resize-direction');

    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;

    let newWidth = resizeStartWidth;
    let newHeight = resizeStartHeight;
    let newLeft = resizeStartLeft;
    let newTop = resizeStartTop;
    let shouldUpdatePosition = false;

    // Calculate new dimensions and position based on resize direction
    // This implements OS-like window resizing where the opposite edge/corner stays fixed

    // Handle horizontal resizing
    if (resizeDirection.includes('w')) {
        // Left edge: width changes AND left position moves
        const widthChange = -deltaX; // Negative because we're moving left edge left/right
        newWidth = Math.max(200, resizeStartWidth + widthChange);
        newLeft = resizeStartLeft + (resizeStartWidth - newWidth);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('e')) {
        // Right edge: width changes, left stays the same
        newWidth = Math.max(200, resizeStartWidth + deltaX);
    }

    // Handle vertical resizing
    if (resizeDirection.includes('n')) {
        // Top edge: height changes AND top position moves
        const heightChange = -deltaY; // Negative because we're moving top edge up/down
        newHeight = Math.max(150, resizeStartHeight + heightChange);
        newTop = resizeStartTop + (resizeStartHeight - newHeight);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('s')) {
        // Bottom edge: height changes, top stays the same
        newHeight = Math.max(150, resizeStartHeight + deltaY);
    }

    // Apply constraints based on dataset values
    const maxWidth = resizedModal.dataset.windowMaxWidth ?
        parseInt(resizedModal.dataset.windowMaxWidth) : Infinity;
    const maxHeight = resizedModal.dataset.windowMaxHeight ?
        parseInt(resizedModal.dataset.windowMaxHeight) : Infinity;
    const minWidth = resizedModal.dataset.windowMinWidth ?
        parseInt(resizedModal.dataset.windowMinWidth) : 200; // Reasonable minimum
    const minHeight = resizedModal.dataset.windowMinHeight ?
        parseInt(resizedModal.dataset.windowMinHeight) : 150; // Reasonable minimum

    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
    newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

    // Apply new dimensions
    resizedModal.style.width = `${newWidth}px`;
    resizedModal.style.height = `${newHeight}px`;

    // Only update position if we actually moved the window (left/top edge resize)
    if (shouldUpdatePosition) {
        // Convert viewport coordinates back to modal offset coordinates
        const offsetX = (newLeft + newWidth / 2) - (window.innerWidth / 2);
        const offsetY = (newTop + newHeight / 2) - (window.innerHeight / 2);

        resizedModal.style.setProperty('--modal-offset-x', `${offsetX}px`);
        resizedModal.style.setProperty('--modal-offset-y', `${offsetY}px`);
    }
}

function handleModalResizeEnd(e, resizedModal) {
    if (!resizedModal) return;

    // Check backdrop when stopping resize
    updateBackdropVisibility();

    // Clear resize state data attributes
    resizedModal.removeAttribute('data-resizing');
    resizedModal.removeAttribute('data-resize-start-x');
    resizedModal.removeAttribute('data-resize-start-y');
    resizedModal.removeAttribute('data-resize-start-width');
    resizedModal.removeAttribute('data-resize-start-height');
    resizedModal.removeAttribute('data-resize-start-left');
    resizedModal.removeAttribute('data-resize-start-top');
    resizedModal.removeAttribute('data-resize-direction');
}

function openModal(modal) {
    if (!modal) return;

    // Check if modal is already open
    const isAlreadyOpen = !modal.classList.contains('hidden');

    if (isAlreadyOpen) {
        // Modal is already open, bring it to front if it's moveable
        const isManualModal = modal.id === 'manualModal';
        const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
        const isMoveable = hasTitleBar && !isManualModal;

        if (isMoveable) {
            bringModalToFront(modal);
        }
        return;
    }

    // Check if this modal should trigger backdrop display
    // Modals that are transient OR have been moved don't trigger backdrop
    const shouldTriggerBackdrop = !modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved');

    if (shouldTriggerBackdrop) {
        // Check if this is the first non-transient, non-moved modal opening
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const otherOpenNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
            m !== modal &&
            !m.classList.contains('hidden') &&
            (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
            m !== draggedModal
        );
        const isFirstNonTransientModal = otherOpenNonTransientModals.length === 0;

        // If this is the first non-transient, non-moved modal, animate the backdrop in
        if (isFirstNonTransientModal && backdrop) {
            backdrop.classList.remove('fade-out');
            backdrop.classList.add('fade-in');
        }
    }

    // Assign z-index to modal (newly opened modals go on top) - but only for moveable modals
    // Skip z-index management for manual modal and non-moveable modals
    const isManualModal = modal.id === 'manualModal';
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isManualModal;

    if (isMoveable) {
        assignModalZIndex(modal);
    }

    // Add resize handles for resizable windows
    if (modal.classList.contains('resizeable-window')) {
        addResizeHandles(modal);
    }

    // Add opening class to trigger animation
    modal.classList.add('opening');
    // Remove hidden class to show modal
    modal.classList.remove('hidden');

    // Only add modal-open class for non-transient, non-moved modals
    if (!modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved')) {
        document.body.classList.add('modal-open');
    }

    // Add click handler to bring modal to front
    const clickHandler = (e) => {
        // Only handle clicks on the modal itself, not on interactive elements
        if (!e.target.closest('button, input, select, textarea, .resize-handle')) {
            handleModalClick(modal);
        }
    };
    modal.addEventListener('mousedown', clickHandler);

    // Store the click handler for cleanup
    modal._modalClickHandler = clickHandler;

    // Remove opening class after animation completes
    setTimeout(() => {
        modal.classList.remove('opening');
    }, 600); // Match animation duration
}

function closeModal(modal) {
    if (!modal) return;

    // Check if this modal should trigger backdrop changes
    // Modals that are transient OR have been moved don't trigger backdrop
    const shouldTriggerBackdrop = !modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved');

    let isLastNonTransientModal = false;
    if (shouldTriggerBackdrop) {
        // Check if this is the last non-transient, non-moved modal closing
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const otherOpenNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
            m !== modal &&
            !m.classList.contains('hidden') &&
            (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
            m !== draggedModal
        );
        isLastNonTransientModal = otherOpenNonTransientModals.length === 0;
    }

    // Add closing class to trigger animation
    modal.classList.add('closing');

    // If this is the last non-transient, non-moved modal, animate the backdrop out
    if (isLastNonTransientModal && backdrop) {
        backdrop.classList.add('fade-out');
        // Remove fade-in class after a short delay to let fade-out animation start
        setTimeout(() => {
            backdrop.classList.remove('fade-in');
        }, 50);
    }

    // Wait for animation to complete before hiding
    setTimeout(() => {
        // Reset modal position offsets
        modal.style.removeProperty('--modal-offset-x');
        modal.style.removeProperty('--modal-offset-y');

        // Remove resize values and data attributes
        modal.style.removeProperty('width');
        modal.style.removeProperty('height');
        modal.removeAttribute('data-resizing');
        modal.removeAttribute('data-resize-start-x');
        modal.removeAttribute('data-resize-start-y');
        modal.removeAttribute('data-resize-start-width');
        modal.removeAttribute('data-resize-start-height');
        modal.removeAttribute('data-resize-start-left');
        modal.removeAttribute('data-resize-start-top');
        modal.removeAttribute('data-resize-direction');

        // Remove modal from stack and update z-indexes
        const modalIndex = modalStack.indexOf(modal);
        if (modalIndex !== -1) {
            modalStack.splice(modalIndex, 1);
            updateModalStackZIndexes();
        }

        // Reset z-index state (but keep moved state)
        modal.removeAttribute('data-modal-z-index');
        modal.removeAttribute('data-modal-stack-position');

        // Clean up click handler
        if (modal._modalClickHandler) {
            modal.removeEventListener('mousedown', modal._modalClickHandler);
            delete modal._modalClickHandler;
        }

        // Remove resize handles
        const resizeHandles = modal.querySelectorAll('.resize-handle');
        resizeHandles.forEach(handle => handle.remove());

        // Add hidden class to hide modal
        modal.classList.add('hidden');
        // Remove closing class
        modal.classList.remove('closing');

        // Only remove modal-open if this was a non-transient, non-moved modal and it's the last one
        if (shouldTriggerBackdrop && isLastNonTransientModal) {
            document.body.classList.remove('modal-open');
            // Reset backdrop after modal is hidden
            if (backdrop) {
                setTimeout(() => {
                    backdrop.classList.remove('fade-out');
                }, 500);
            }
        }
    }, 300); // Match animation duration
}

// Modal z-index management functions
function assignModalZIndex(modal) {
    // Add modal to the top of the stack if not already there
    const modalIndex = modalStack.indexOf(modal);
    if (modalIndex !== -1) {
        // Modal already in stack, remove it first
        modalStack.splice(modalIndex, 1);
    }
    // Add to top of stack (end of array)
    modalStack.push(modal);

    // Reassign z-indexes to all modals in the stack
    updateModalStackZIndexes();
}

function bringModalToFront(modal) {
    // Move modal to the top of the stack
    const modalIndex = modalStack.indexOf(modal);
    if (modalIndex !== -1) {
        // Remove from current position
        modalStack.splice(modalIndex, 1);
    }
    // Add to top of stack
    modalStack.push(modal);

    // Reassign z-indexes to all modals in the stack
    updateModalStackZIndexes();
}

function updateModalStackZIndexes() {
    // Assign z-indexes based on stack position (bottom to top)
    modalStack.forEach((modal, index) => {
        const zIndex = MODAL_Z_BASE + (index * MODAL_Z_INCREMENT);
        modal.setAttribute('data-modal-z-index', zIndex);
        modal.setAttribute('data-modal-stack-position', index + 1);
        modal.style.zIndex = zIndex;
    });
}

function handleModalClick(modal) {
    // Bring modal to front when clicked (unless it's currently being dragged) - only for moveable modals
    const isManualModal = modal.id === 'manualModal';
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isManualModal;

    if (isMoveable && !modal.hasAttribute('data-dragging')) {
        bringModalToFront(modal);
    }
}

// Add resize handles to a modal
function addResizeHandles(modal) {
    // Check if handles already exist
    if (modal.querySelector('.resize-handle')) return;

    // Create resize handles
    const handles = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
    handles.forEach(direction => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${direction}`;
        modal.appendChild(handle);
    });
}

// Update backdrop and scroll blocking based on current modal state
function updateBackdropVisibility() {
    if (!backdrop) return;

    // Count visible non-transient, non-moved modals that are not being dragged or resized
    const draggedModal = document.querySelector('.modal[data-dragging="true"]');
    const resizedModal = document.querySelector('.modal[data-resizing="true"]');
    const visibleNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
        !m.classList.contains('hidden') &&
        (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
        m !== draggedModal &&
        m !== resizedModal
    );

    const shouldShowBackdrop = visibleNonTransientModals.length > 0;

    if (shouldShowBackdrop && !backdrop.classList.contains('fade-in')) {
        // Show backdrop
        backdrop.classList.remove('fade-out');
        backdrop.classList.add('fade-in');
    } else if (!shouldShowBackdrop && !backdrop.classList.contains('fade-out')) {
        // Hide backdrop
        backdrop.classList.add('fade-out');
        setTimeout(() => {
            backdrop.classList.remove('fade-in');
        }, 50);
    }

    // Also manage scroll blocking (modal-open class on body)
    if (shouldShowBackdrop && !document.body.classList.contains('modal-open')) {
        document.body.classList.add('modal-open');
    } else if (!shouldShowBackdrop && document.body.classList.contains('modal-open')) {
        document.body.classList.remove('modal-open');
    }
}

// Initialize modal dragging when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeModalDragging);
} else {
    initializeModalDragging();
}