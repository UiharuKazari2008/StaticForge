// Global tracking for open dropdowns
const openDropdowns = new Set();
const DROPDOWN_PANEL_FADE_OUT_MS = 300;

/** Dropdowns with an open menu — guarded by a single document click listener. */
const dropdownGuardEntries = new Map();
let dropdownGuardClickHandler = null;

function ensureDropdownGuardListener() {
    if (dropdownGuardClickHandler) return;
    dropdownGuardClickHandler = (e) => {
        dropdownGuardEntries.forEach((entry) => {
            if (!entry.container.contains(e.target)) {
                closeDropdown(entry.menu, entry.button);
            }
        });
    };
    document.addEventListener('click', dropdownGuardClickHandler);
}

function teardownDropdownGuardListener() {
    if (!dropdownGuardClickHandler) return;
    document.removeEventListener('click', dropdownGuardClickHandler);
    dropdownGuardClickHandler = null;
}

/**
 * Register a dropdown for outside-click dismissal while its menu is open.
 * Replaces per-dropdown permanent document click listeners from setupDropdown.
 */
function registerDropdownGuard(container, menu, button) {
    if (!container || !menu || !button) return;

    if (container._dropdownOutsideClick) {
        document.removeEventListener('click', container._dropdownOutsideClick);
        container._dropdownOutsideClick = null;
    }

    dropdownGuardEntries.set(container, { container, menu, button });
    ensureDropdownGuardListener();
}

function unregisterDropdownGuard(container) {
    if (!container) return;
    dropdownGuardEntries.delete(container);
    if (dropdownGuardEntries.size === 0) {
        teardownDropdownGuardListener();
    }
}

function getDropdownContainer(menu, button) {
    return (menu && menu._dropdownContainer) || (button && button._dropdownContainer) || null;
}

function closeAllDropdownsInRoot(root) {
    if (!root) return;
    root.querySelectorAll('.custom-dropdown[data-dropdown-initialized="true"]').forEach((container) => {
        const menu = container._dropdownMenu;
        const button = container._dropdownButton;
        if (menu && button) {
            closeDropdown(menu, button);
        }
    });
}

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
    if (!menu) return;

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

    const container = getDropdownContainer(menu, button);
    if (container) {
        registerDropdownGuard(container, menu, button);
    }
}

/**
 * Closes a dropdown menu.
 */
function closeDropdown(menu, button) {
    if (!menu) return;

    const container = getDropdownContainer(menu, button);
    if (container) {
        unregisterDropdownGuard(container);
    }

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
    if (!menu) return;
    if (!menu.classList.contains('hidden') || menu.classList.contains('custom-dropdown-closing')) {
        closeDropdown(menu, button);
    } else {
        openDropdown(menu, button);
    }
}

/**
 * Remove document-level listeners registered by setupDropdown.
 * Call before removing dropdown DOM (dynamic toolbars, character fields, etc.).
 */
function teardownDropdown(container) {
    if (!container || container.getAttribute('data-dropdown-initialized') !== 'true') {
        return;
    }

    const button = container._dropdownButton;
    const menu = container._dropdownMenu;
    if (menu && button) {
        closeDropdown(menu, button);
    }

    unregisterDropdownGuard(container);

    if (container._dropdownOutsideClick) {
        document.removeEventListener('click', container._dropdownOutsideClick);
        container._dropdownOutsideClick = null;
    }

    container._dropdownButton = null;
    container._dropdownMenu = null;
    container.removeAttribute('data-dropdown-initialized');
}

/**
 * Sets up a dropdown menu with open/close logic and optional keyboard navigation.
 */
function setupDropdown(container, button, menu, render, getSelectedValue, options = {}) {
    if (!container || !button || !menu) return;

    // Each setup adds a document click listener — skip if already wired.
    if (container.getAttribute('data-dropdown-initialized') === 'true') {
        return;
    }
    container.setAttribute('data-dropdown-initialized', 'true');
    container._dropdownButton = button;
    container._dropdownMenu = menu;
    menu._dropdownContainer = container;
    button._dropdownContainer = container;

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
    
    // Outside click handled by registerDropdownGuard when menu opens (openDropdown).
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

/**
 * Drop-down lists (Yukimi, Nov 20 2026: "0 plain dropdowns"): every <select class="vdt-select"> in the app opens
 * the platform's list, never the browser's or Android's picker. The desktop drops Vista's ComboLBox under the control
 * (vistaDropList, the one implementation: vistaDialogTemplate.js uses it too); the phone shell hangs WM's drop-down
 * from it (wmShell.dropdown). The <select> keeps the value and its events. Keys as Win32's CBS_DROPDOWNLIST: F4,
 * Alt+Down / Alt+Up and Space drop the list; Up / Down / Left / Right / Home / End / Page keys step the value
 * without it. A press already taken (a vdt dialog's own wiring, an app's handler) is left alone.
 */
(function vistaDropLists() {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /**
     * A combo box's dropped list (the ComboLBox): Vista's list box under the control, over everything. opts:
     * { items [{ value, text }], value, room (px the template allows, else comctl32 v6's 30 rows), pick(value),
     * focus (the element that keeps the focus and hears the keys) }. A second open of the same box closes it.
     */
    function vistaDropList(box, opts) {
        const old = document.querySelector('.vdt-combo-pop');
        if (old) { const was = old._box; old._close(); if (was === box) return; }
        const items = opts.items || [];
        const focusEl = opts.focus;
        const r = box.getBoundingClientRect();
        const pop = document.createElement('div');
        const cs = getComputedStyle(focusEl);
        // MS Shell Dlg 8 (Tahoma, 11 px) rows are 13 px, Segoe UI 9 pt rows 15 (the VM's devmgr Property list: 13)
        pop.className = `vdt-combo-pop vdt-listbox${parseFloat(cs.fontSize) <= 11 ? ' is-small' : ''}`;
        pop.setAttribute('role', 'listbox');
        pop.style.font = cs.font;
        pop.innerHTML = items.length ? items.map((o) => `<div class="vdt-lb-row${String(o.value) === String(opts.value) ? ' is-selected' : ''}" data-value="${esc(o.value)}" role="option"><span>${esc(o.text)}</span></div>`).join('') : '<div class="vdt-lb-row" data-empty="1"><span>&nbsp;</span></div>';
        const n = Math.max(1, items.length);
        pop.style.left = `${Math.round(r.left)}px`;
        pop.style.width = `${Math.round(r.width)}px`;
        document.body.appendChild(pop);
        const rowH = (pop.querySelector('.vdt-lb-row') || pop).getBoundingClientRect().height || 13;
        const room = opts.room || rowH * 30 + 2;
        const h = Math.round(Math.max(1, Math.min(n, Math.floor((room - 2) / rowH))) * rowH + 2);
        const below = window.innerHeight - r.bottom;
        pop.style.height = `${h}px`;
        pop.style.top = `${Math.round(below >= h || below >= r.top ? r.bottom : r.top - h)}px`;
        const sel = pop.querySelector('.is-selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
        const pick = (row) => { if (row && !row.dataset.empty) opts.pick(row.dataset.value); };
        const close = () => {
            pop.remove();
            document.removeEventListener('mousedown', outside, true);
            document.removeEventListener('touchstart', outside, true);
            focusEl.removeEventListener('keydown', keys, true);
            focusEl.removeEventListener('blur', blurred);
            window.removeEventListener('resize', close);
            box.classList.remove('is-open');
        };
        // a press on the box itself is the box's own (it closes the list through its toggle)
        const outside = (ev) => { if (!pop.contains(ev.target) && !box.contains(ev.target)) close(); };
        const blurred = () => setTimeout(() => { if (pop.isConnected && document.activeElement !== focusEl) close(); }, 0);
        const keys = (ev) => {
            const list = Array.from(pop.querySelectorAll('.vdt-lb-row[data-value]'));
            let i = list.findIndex((x) => x.classList.contains('is-selected'));
            if (ev.key === 'Escape' || ev.key === 'Tab' || ev.key === 'F4' || (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown'))) { if (ev.key !== 'Tab') { ev.preventDefault(); ev.stopPropagation(); } close(); return; }
            if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); pick(list[i]); close(); return; }
            const page = Math.max(1, Math.floor(h / rowH) - 1);
            const step = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -1e6, End: 1e6 }[ev.key];
            if (!step) return;
            ev.preventDefault();
            ev.stopPropagation();
            i = Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + step));
            list.forEach((x, j) => x.classList.toggle('is-selected', j === i));
            if (list[i]) { list[i].scrollIntoView({ block: 'nearest' }); pick(list[i]); }
        };
        pop.addEventListener('mousedown', (ev) => ev.preventDefault());
        pop.addEventListener('mousemove', (ev) => {
            const row = ev.target.closest('.vdt-lb-row[data-value]');
            if (row && !row.classList.contains('is-selected')) { pop.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected')); row.classList.add('is-selected'); }
        });
        pop.addEventListener('click', (ev) => { pick(ev.target.closest('.vdt-lb-row')); close(); focusEl.focus(); });
        pop._box = box;
        pop._close = close;
        box.classList.add('is-open');
        focusEl.focus();
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('touchstart', outside, true);
        focusEl.addEventListener('keydown', keys, true);
        focusEl.addEventListener('blur', blurred);
        window.addEventListener('resize', close);
    }

    const choices = (select) => Array.from(select.options).filter((o) => !o.hidden);
    const setValue = (select, v) => {
        if (select.value === v) return;
        select.value = v;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const phoneShell = () => document.documentElement.classList.contains('ui-mobile') && window.wmShell && typeof window.wmShell.dropdown === 'function' && document.getElementById('wmShell');

    /** Drop a <select>'s list: Vista's ComboLBox, or WM's drop-down on the phone shell. pick(v) after the value is set. */
    function vistaSelectDrop(select, pick) {
        if (!select || select.disabled) return;
        const done = (v) => { setValue(select, v); if (typeof pick === 'function') pick(v); };
        if (phoneShell()) {
            window.wmShell.dropdown(select, choices(select).map((o) => ({ label: o.text, radio: o.value === select.value, disabled: o.disabled, action: () => done(o.value) })));
            return;
        }
        vistaDropList(select, {
            items: choices(select).map((o) => ({ value: o.value, text: o.text })),
            value: select.value,
            focus: select,
            pick: done
        });
    }

    /** Up / Down / Home / End / Page keys on a closed drop-down list: the next choice, no list (Win32). */
    function vistaSelectStep(select, key, pick) {
        const opts = choices(select).filter((o) => !o.disabled);
        if (!opts.length) return;
        let i = opts.findIndex((o) => o.value === select.value);
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 10, PageUp: -10, Home: -1e6, End: 1e6 }[key];
        i = Math.max(0, Math.min(opts.length - 1, (i < 0 ? 0 : i) + step));
        if (opts[i].value === select.value) return;
        setValue(select, opts[i].value);
        if (typeof pick === 'function') pick(opts[i].value);
    }

    window.vistaDropList = vistaDropList;
    window.vistaSelectDrop = vistaSelectDrop;
    window.vistaSelectStep = vistaSelectStep;

    const isDropList = (t) => t && t.matches && t.matches('select.vdt-select:not([multiple])');
    // the press, the tap's touchend and the click are taken, so the browser's picker never opens
    const takePress = (ev) => {
        if (ev.defaultPrevented || !isDropList(ev.target)) return;
        ev.preventDefault();
        if (ev.type === 'click' || ev.target.disabled || (ev.type === 'mousedown' && ev.button !== 0)) return;
        ev.target.focus();
        vistaSelectDrop(ev.target);
    };
    // app-scope: allow page lifetime (the shell's drop-down lists: dropdown.js is loaded once from app.html)
    document.addEventListener('mousedown', takePress);
    // app-scope: allow page lifetime (as above)
    document.addEventListener('touchend', takePress, { passive: false });
    // app-scope: allow page lifetime (as above)
    document.addEventListener('click', takePress);
    // app-scope: allow page lifetime (as above)
    document.addEventListener('keydown', (ev) => {
        const sel = ev.target;
        if (ev.defaultPrevented || !isDropList(sel) || sel.classList.contains('is-open')) return;
        // Enter belongs to the window (its default button), never the browser's picker
        if (ev.key === 'Enter') { ev.preventDefault(); return; }
        if (ev.key === 'F4' || ev.key === ' ' || (ev.altKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'))) { ev.preventDefault(); vistaSelectDrop(sel); return; }
        if (/^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End)$/.test(ev.key) && !ev.altKey) { ev.preventDefault(); vistaSelectStep(sel, ev.key); }
    });
})();
