/** Generate button hover popover (Phase 2 batch 13). */
function showGenerateButtonPopoverFor(button) {
    const counter = imageCount || '0';
    const popover = createGenerateButtonPopover(counter);
    showGenerateButtonPopoverForButton(button, popover);
}

function showGenerateButtonPopoverForButton(button, popover) {

    // Add to DOM first to get dimensions
    document.body.appendChild(popover);

    // Get viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Position the popover above the button
    const buttonRect = button.getBoundingClientRect();
    popover.style.position = 'fixed';

    // Calculate initial position (above the button)
    let top = buttonRect.top - popover.offsetHeight - 10;
    let left = buttonRect.left + (buttonRect.width / 2) - (popover.offsetWidth / 2);

    // Check if popover goes above viewport
    if (top < 10) {
        // Position below the button instead
        top = buttonRect.bottom + 10;
        popover.classList.add('below');
    }

    // Check if popover goes below viewport
    if (top + popover.offsetHeight > viewportHeight - 10) {
        // Position above the button (original position)
        top = buttonRect.top - popover.offsetHeight - 10;
        popover.classList.remove('below');
    }

    // Check if popover goes left of viewport
    if (left < 10) {
        left = 10;
    }

    // Check if popover goes right of viewport
    if (left + popover.offsetWidth > viewportWidth - 10) {
        left = viewportWidth - popover.offsetWidth - 10;
    }

    // Apply final position
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    // Store reference for cleanup
    button.popoverElement = popover;
}

function hideGenerateButtonPopoverFor(button) {
    if (button && button.popoverElement) {
        button.popoverElement.remove();
        button.popoverElement = null;
    }
}

function createGenerateButtonPopover(counter) {
    const popover = document.createElement('div');
    popover.className = 'generate-button-popover';
    popover.innerHTML = `
        <div class="popover-content">
            <div class="popover-header">
                <i class="fas fa-chart-line"></i>
                <span>Generation Count</span>
            </div>
            <div class="popover-body">
                <div class="counter-value">${counter}</div>
                <div class="counter-label">Images Generated</div>
            </div>
        </div>
        <div class="popover-arrow"></div>
    `;
    return popover;
}

