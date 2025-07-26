// Dropdown menu utilities (moved from script.js)

/**
 * Renders a grouped dropdown menu.
 * @param {HTMLElement} menu - The dropdown menu element.
 * @param {Array} groups - Array of group objects with {group, options}.
 * @param {Function} selectHandler - Called when an option is selected.
 * @param {Function} closeHandler - Called to close the dropdown.
 * @param {string} selectedVal - The currently selected value.
 * @param {Function} renderOptionContent - Function to render option HTML.
 */
function renderGroupedDropdown(menu, groups, selectHandler, closeHandler, selectedVal, renderOptionContent) {
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
            option.addEventListener('click', action);
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
 * Opens a dropdown menu.
 */
function openDropdown(menu, button) {
    menu.style.display = 'block';
    if (button) button.classList.add('active');
}

/**
 * Closes a dropdown menu.
 */
function closeDropdown(menu, button) {
    menu.style.display = 'none';
    if (button) button.classList.remove('active');
}

/**
 * Toggles a dropdown menu.
 */
function toggleDropdown(menu, button) {
    if (menu.style.display === 'block') {
        closeDropdown(menu, button);
    } else {
        openDropdown(menu, button);
    }
}

/**
 * Sets up a dropdown menu with open/close logic.
 */
function setupDropdown(container, button, menu, render, getSelectedValue) {
    if (!container || !button || !menu) return;
    button.addEventListener('click', async e => {
        e.stopPropagation();
        if (menu.style.display === 'block') {
            closeDropdown(menu, button);
        } else {
            await render(getSelectedValue());
            openDropdown(menu, button);
        }
    });
    document.addEventListener('click', e => {
        if (!container.contains(e.target)) {
            closeDropdown(menu, button);
        }
    });
}
