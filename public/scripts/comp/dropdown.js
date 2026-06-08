// Global tracking for open dropdowns
const openDropdowns = new Set();
const DROPDOWN_PANEL_FADE_OUT_MS = 300;

function _clearDropdownAnimation(menu, className, handler) {
    menu.classList.remove(className);
    if (handler) {
        menu.removeEventListener('animationend', handler);
    }
}

function _playDropdownOpenAnimation(menu) {
    _clearDropdownAnimation(menu, 'custom-dropdown-closing');
    menu.classList.remove('custom-dropdown-opening');
    void menu.offsetWidth;
    menu.classList.add('custom-dropdown-opening');

    let cleared = false;
    const clearOpening = () => {
        if (cleared) return;
        cleared = true;
        _clearDropdownAnimation(menu, 'custom-dropdown-opening', onOpenEnd);
    };

    const onOpenEnd = (e) => {
        if (e.target !== menu || e.animationName !== 'customDropdownFadeIn') return;
        clearOpening();
    };

    menu.addEventListener('animationend', onOpenEnd);
    setTimeout(clearOpening, 260);
}

function _playDropdownCloseAnimation(menu) {
    if (menu.classList.contains('hidden') || menu.classList.contains('custom-dropdown-closing')) {
        return;
    }

    _clearDropdownAnimation(menu, 'custom-dropdown-opening');
    menu.classList.add('custom-dropdown-closing');

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        _clearDropdownAnimation(menu, 'custom-dropdown-closing', onCloseEnd);
        menu.classList.add('hidden');
    };

    const onCloseEnd = (e) => {
        if (e.target !== menu || e.animationName !== 'customDropdownFadeOut') return;
        finish();
    };

    menu.addEventListener('animationend', onCloseEnd);
    setTimeout(finish, DROPDOWN_PANEL_FADE_OUT_MS);
}

/**
 * Renders a grouped dropdown menu.
 * @param {HTMLElement} menu - The dropdown menu element.
 * @param {Array} groups - Array of group objects with {group, options}.
 * @param {Function} selectHandler - Called when an option is selected.
 * @param {Function} closeHandler - Called to close the dropdown.
 * @param {string} selectedVal - The currently selected value.
 * @param {Function} renderOptionContent - Function to render option HTML.
 * @param {Object} options - Optional configuration object.
 * @param {boolean} options.preventFocusTransfer - If true, prevents focus transfer on option clicks.
 */
function renderGroupedDropdown(menu, groups, selectHandler, closeHandler, selectedVal, renderOptionContent, options = {}) {
    const preventFocusTransfer = options.preventFocusTransfer !== false; // Default to true
    
    menu.innerHTML = '';
    groups.forEach(group => {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-dropdown-group';
        groupHeader.textContent = group.group;
        menu.appendChild(groupHeader);
        group.options.forEach(opt => {
            const option = document.createElement('div');
            option.className = 'custom-dropdown-option' + (selectedVal === opt.value ? ' selected' : '');
            option.tabIndex = 0;
            option.dataset.value = opt.value;
            option.dataset.group = group.group;
            option.innerHTML = renderOptionContent(opt, group);
            const action = () => {
                selectHandler(opt.value, group.group);
                closeHandler();
            };
            // Prevent focus transfer on mousedown if enabled
            if (preventFocusTransfer) {
                option.addEventListener('mousedown', e => {
                    e.preventDefault();
                });
            }
            option.addEventListener('click', action);
            touchSlopUtils.registerTouchSlopTracking(option);
            option.addEventListener('touchend', (e) => {
                const maxDelta = touchSlopUtils.finalizeTouchSlop(option, e);
                if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
                e.preventDefault();
                action();
            }, { passive: false });
            option.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    action();
                }
            });
            menu.appendChild(option);
        });
    });
}

/**
 * Opens a dropdown menu. Automatically closes any other open dropdowns.
 */
function openDropdown(menu, button) {
    // Close all other open dropdowns first
    openDropdowns.forEach(dropdown => {
        if (dropdown.menu !== menu) {
            closeDropdown(dropdown.menu, dropdown.button);
        }
    });
    
    menu.classList.remove('hidden', 'custom-dropdown-closing');
    if (button) button.classList.add('active');
    _playDropdownOpenAnimation(menu);

    openDropdowns.add({ menu, button });
}

/**
 * Closes a dropdown menu.
 */
function closeDropdown(menu, button) {
    if (menu.classList.contains('hidden') && !menu.classList.contains('custom-dropdown-closing')) {
        if (button) button.classList.remove('active');
        openDropdowns.forEach(dropdown => {
            if (dropdown.menu === menu) {
                openDropdowns.delete(dropdown);
            }
        });
        return;
    }

    if (button) button.classList.remove('active');

    openDropdowns.forEach(dropdown => {
        if (dropdown.menu === menu) {
            openDropdowns.delete(dropdown);
        }
    });

    _playDropdownCloseAnimation(menu);
}

/**
 * Toggles a dropdown menu.
 */
function toggleDropdown(menu, button) {
    if (!menu.classList.contains('hidden') || menu.classList.contains('custom-dropdown-closing')) {
        closeDropdown(menu, button);
    } else {
        openDropdown(menu, button);
    }
}

/**
 * Sets up a dropdown menu with open/close logic and optional keyboard navigation.
 */
function setupDropdown(container, button, menu, render, getSelectedValue, options = {}) {
    if (!container || !button || !menu) return;
    
    const enableKeyboardNav = options.enableKeyboardNav || false;
    const enableRightKey = options.enableRightKey || false;
    const onNavigateRight = options.onNavigateRight || null;
    const onNavigateLeft = options.onNavigateLeft || null;
    const onSelectOption = options.onSelectOption || null;
    const preventFocusTransfer = options.preventFocusTransfer !== false; // Default to true
    
    let selectedOptionIndex = -1;
    
    // Prevent focus transfer when clicking the button
    if (preventFocusTransfer) {
        button.addEventListener('mousedown', e => {
            e.preventDefault();
        });
    }
    
    button.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        if (!menu.classList.contains('hidden') || menu.classList.contains('custom-dropdown-closing')) {
            closeDropdown(menu, button);
        } else {
            await render(getSelectedValue());
            openDropdown(menu, button);
            if (enableKeyboardNav) {
                // Focus the menu for keyboard navigation
                setTimeout(() => {
                    menu.focus();
                    selectedOptionIndex = -1;
                    updateSelectedOption(menu, selectedOptionIndex);
                }, 10);
            }
        }
    });
    
    if (enableKeyboardNav) {
        // Add keyboard navigation
        menu.addEventListener('keydown', e => {
            e.preventDefault();
            // Stop propagation to prevent conflicts with other keyboard handlers
            e.stopPropagation();
            
            const options = menu.querySelectorAll('.custom-dropdown-option');
            
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    selectedOptionIndex = Math.min(selectedOptionIndex + 1, options.length - 1);
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    selectedOptionIndex = Math.max(selectedOptionIndex - 1, -1);
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'PageDown':
                    e.preventDefault();
                    if (selectedOptionIndex === -1) {
                        selectedOptionIndex = 0;
                    } else {
                        selectedOptionIndex = Math.min(selectedOptionIndex + 10, options.length - 1);
                    }
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'PageUp':
                    e.preventDefault();
                    if (selectedOptionIndex === -1) {
                        selectedOptionIndex = 0;
                    } else {
                        selectedOptionIndex = Math.max(selectedOptionIndex - 10, 0);
                    }
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'Home':
                    e.preventDefault();
                    selectedOptionIndex = 0;
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'End':
                    e.preventDefault();
                    selectedOptionIndex = options.length - 1;
                    updateSelectedOption(menu, selectedOptionIndex);
                    break;
                    
                case 'Enter':
                    e.preventDefault();
                    if (selectedOptionIndex >= 0 && options[selectedOptionIndex]) {
                        const option = options[selectedOptionIndex];
                        const value = option.dataset.value;
                        const group = option.dataset.group;
                        if (onSelectOption) {
                            onSelectOption(value, group, 'enter');
                        } else {
                            option.click();
                        }
                    }
                    break;
                    
                case 'ArrowRight':
                    if (enableRightKey) {
                        e.preventDefault();
                        if (selectedOptionIndex >= 0 && options[selectedOptionIndex] && onNavigateRight) {
                            const option = options[selectedOptionIndex];
                            const value = option.dataset.value;
                            const group = option.dataset.group;
                            onNavigateRight(value, group);
                        }
                    }
                    break;
                    
                case 'ArrowLeft':
                    if (onNavigateLeft) {
                        e.preventDefault();
                        onNavigateLeft();
                    }
                    break;
                    
                case 'Escape':
                    e.preventDefault();
                    closeDropdown(menu, button);
                    break;
            }
        });
        
        // Ensure menu can receive focus
        menu.tabIndex = 0;
    }
    
    document.addEventListener('click', e => {
        if (!container.contains(e.target)) {
            closeDropdown(menu, button);
        }
    });
}

/**
 * Updates the visual selection of options for keyboard navigation.
 */
function updateSelectedOption(menu, selectedIndex) {
    const options = menu.querySelectorAll('.custom-dropdown-option');
    options.forEach((option, index) => {
        if (index === selectedIndex) {
            option.classList.add('keyboard-selected');
            // Use custom scroll function if available, otherwise fall back to scrollIntoView
            if (typeof scrollToOption === 'function') {
                scrollToOption(option);
            } else {
                option.scrollIntoView({ block: 'nearest' });
            }
        } else {
            option.classList.remove('keyboard-selected');
        }
    });
}
