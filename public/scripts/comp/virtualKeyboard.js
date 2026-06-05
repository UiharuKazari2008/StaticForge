// Virtual on-screen keyboard — client-only; docked on mobile, tool window on desktop.
// replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
// openModal, closeModal, bringModalToFront, setModalOffsetPx: public/scripts/comp/modalUtils.js

const VK_STORAGE_KEY = 'virtualKeyboardEnabled';
const VK_POINTER_SLOP_PX = 8;
const VK_SPACE_TAP_MS = 250;
const VK_WIDE_MIN_PX = 640;

let virtualKeyboardEnabled = false;
let virtualKeyboardActiveTarget = null;
let virtualKeyboardAttachMeta = null;
let virtualKeyboardInitialized = false;
let virtualKeyboardVisible = false;
let virtualKeyboardLayoutObserver = null;

const virtualKeyboardModifiers = {
    shift: false,
    ctrl: false,
    alt: false
};

let virtualKeyboardSpaceTrack = null;

/** @returns {{ char: string, shift?: string }} */
function vkChar(base, shift) {
    return { char: base, shift };
}

/** @returns {{ char: string, shift: string }} */
function vkLetter(ch) {
    return { char: ch, shift: ch.toUpperCase() };
}

/** Familiar QWERTY rows; shift shows alt on number/symbol keys */
const VK_LAYOUT_ROWS = [
    {
        rowClass: 'virtual-keyboard-row--top',
        keys: [
            { special: 'tab', label: 'Tab' },
            vkChar('`', '~'),
            vkChar('1', '!'), vkChar('2', '@'), vkChar('3', '#'), vkChar('4', '$'),
            vkChar('5', '%'), vkChar('6', '^'), vkChar('7', '&'), vkChar('8', '*'),
            vkChar('9', '('), vkChar('0', ')'), vkChar('-', '_'), vkChar('=', '+'),
            { special: 'backspace', label: '⌫' }
        ]
    },
    {
        keys: [
            ...'qwertyuiop'.split('').map((c) => vkLetter(c)),
            vkChar('[', '{'), vkChar(']', '}'), vkChar('\\', '|')
        ]
    },
    {
        rowClass: 'virtual-keyboard-row--home',
        keys: [
            { special: 'shift', label: '⇧' },
            ...'asdfghjkl'.split('').map((c) => vkLetter(c)),
            vkChar(';', ':'), vkChar("'", '"'),
            { special: 'enter', label: '↵' }
        ]
    },
    {
        keys: [
            ...'zxcvbnm'.split('').map((c) => vkLetter(c)),
            vkChar(',', '<'), vkChar('.', '>'), vkChar('/', '?')
        ]
    },
    {
        rowClass: 'virtual-keyboard-row--space',
        keys: [
            { special: 'close', label: '✕' },
            { special: 'ctrl', label: 'Ctrl' },
            { special: 'alt', label: 'Alt' },
            { special: 'space', label: 'Space' }
        ]
    }
];

function isVirtualKeyboardDesktopChrome() {
    return !!(window.isDesktop || document.body.classList.contains('desktop-mode'));
}

function readVirtualKeyboardEnabledFromStorage() {
    try {
        return localStorage.getItem(VK_STORAGE_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

function isVirtualKeyboardEnabled() {
    return virtualKeyboardEnabled === true;
}

function isVirtualKeyboardEligible(el) {
    if (!el || !virtualKeyboardEnabled) return false;
    if (el.closest('#pinModal')) return false;
    if (el.dataset.virtualKeyboard === 'off') return false;
    if (el.disabled) return false;
    if (el.readOnly && !el.dataset.vkReadonlyBypass) return false;

    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type);
    }
    return false;
}

function getVirtualKeyboardModal() {
    return document.getElementById('virtualKeyboardModal');
}

function updateVirtualKeyboardDockPadding() {
    const modal = getVirtualKeyboardModal();
    if (!modal || modal.classList.contains('hidden')) {
        document.documentElement.classList.remove('virtual-keyboard-dock-padding');
        document.documentElement.style.removeProperty('--virtual-keyboard-height');
        return;
    }
    const h = Math.ceil(modal.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--virtual-keyboard-height', `${h}px`);
    document.documentElement.classList.add('virtual-keyboard-dock-padding');
}

function clearVirtualKeyboardDockPadding() {
    document.documentElement.classList.remove('virtual-keyboard-dock-padding');
    document.documentElement.style.removeProperty('--virtual-keyboard-height');
}

function updateVirtualKeyboardWideLayout() {
    const root = document.getElementById('virtualKeyboardKeys');
    const modal = getVirtualKeyboardModal();
    if (!root || !modal) return;

    const wide = isVirtualKeyboardDesktopChrome()
        || modal.getBoundingClientRect().width >= VK_WIDE_MIN_PX;
    root.classList.toggle('virtual-keyboard-keys--wide', wide);
}

function attachVirtualKeyboardSuppress(el) {
    detachVirtualKeyboardSuppress();
    if (!el) return;

    const prevInputMode = el.inputMode;
    const prevReadOnly = el.readOnly;
    el.inputMode = 'none';

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIos) {
        el.readOnly = true;
        el.dataset.vkReadonlyBypass = '1';
        const unlock = () => {
            el.readOnly = prevReadOnly;
            delete el.dataset.vkReadonlyBypass;
            el.removeEventListener('pointerdown', unlock, true);
        };
        el.addEventListener('pointerdown', unlock, true);
    }

    virtualKeyboardAttachMeta = { el, prevInputMode, prevReadOnly };
}

function detachVirtualKeyboardSuppress() {
    if (!virtualKeyboardAttachMeta) return;
    const { el, prevInputMode, prevReadOnly } = virtualKeyboardAttachMeta;
    if (el && el.isConnected) {
        if (prevInputMode) {
            el.inputMode = prevInputMode;
        } else {
            el.removeAttribute('inputmode');
        }
        el.readOnly = prevReadOnly;
        delete el.dataset.vkReadonlyBypass;
    }
    virtualKeyboardAttachMeta = null;
}

let virtualKeyboardInputRaf = 0;
let virtualKeyboardInputTarget = null;

function dispatchInputOnTarget(target) {
    if (!target) return;
    try {
        target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
    } catch (e) {
        target.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/** Defer input listeners so caret/value settle before autofill / highlight handlers run. */
function scheduleVirtualKeyboardInput(target) {
    if (!target) return;
    virtualKeyboardInputTarget = target;
    if (virtualKeyboardInputRaf) return;
    virtualKeyboardInputRaf = requestAnimationFrame(() => {
        virtualKeyboardInputRaf = 0;
        const pendingTarget = virtualKeyboardInputTarget;
        virtualKeyboardInputTarget = null;
        if (pendingTarget && pendingTarget.isConnected) {
            dispatchInputOnTarget(pendingTarget);
        }
    });
}

/** iOS OSK suppress uses readOnly; unlock briefly so setRangeText commits correctly. */
function virtualKeyboardWithEditableTarget(target, fn) {
    if (!target || typeof fn !== 'function') return;
    const needUnlock = target.dataset.vkReadonlyBypass === '1';
    const prevReadOnly = target.readOnly;
    if (needUnlock) {
        target.readOnly = false;
    }
    try {
        fn();
    } finally {
        if (needUnlock) {
            target.readOnly = prevReadOnly;
        }
    }
}

function virtualKeyboardInsertText(text) {
    const target = virtualKeyboardActiveTarget;
    if (!target || text == null || text === '') return;

    if (typeof target.selectionStart !== 'number') return;
    // isTextInputComposing: public/scripts/comp/textareaUtils.js
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target)) return;

    virtualKeyboardWithEditableTarget(target, () => {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        // replaceTextareaRangePreservingUndo: public/scripts/comp/textareaUtils.js
        if (typeof replaceTextareaRangePreservingUndo === 'function') {
            replaceTextareaRangePreservingUndo(target, start, end, text);
        } else {
            target.setRangeText(text, start, end, 'end');
        }
        const newPos = start + String(text).length;
        target.setSelectionRange(newPos, newPos);
    });
    scheduleVirtualKeyboardInput(target);
}

function virtualKeyboardDispatchKey(key, code) {
    const target = virtualKeyboardActiveTarget;
    if (!target) return;

    const opts = {
        key,
        code: code || key,
        bubbles: true,
        cancelable: true,
        ctrlKey: virtualKeyboardModifiers.ctrl,
        altKey: virtualKeyboardModifiers.alt,
        shiftKey: virtualKeyboardModifiers.shift
    };

    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function virtualKeyboardHandleBackspace() {
    const target = virtualKeyboardActiveTarget;
    if (!target || typeof target.selectionStart !== 'number') return;
    if (typeof isTextInputComposing === 'function' && isTextInputComposing(target)) return;

    virtualKeyboardWithEditableTarget(target, () => {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (start !== end) {
            if (typeof replaceTextareaRangePreservingUndo === 'function') {
                replaceTextareaRangePreservingUndo(target, start, end, '');
            } else {
                target.setRangeText('', start, end, 'end');
            }
            target.setSelectionRange(start, start);
        } else if (start > 0) {
            if (typeof replaceTextareaRangePreservingUndo === 'function') {
                replaceTextareaRangePreservingUndo(target, start - 1, start, '');
            } else {
                target.setRangeText('', start - 1, start, 'end');
            }
            target.setSelectionRange(start - 1, start - 1);
        }
    });
    scheduleVirtualKeyboardInput(target);
}

function virtualKeyboardHandleEnter() {
    const target = virtualKeyboardActiveTarget;
    if (!target) return;
    if (target.tagName === 'TEXTAREA') {
        virtualKeyboardInsertText('\n');
    } else {
        virtualKeyboardDispatchKey('Enter', 'Enter');
    }
}

function virtualKeyboardHandleTab() {
    const target = virtualKeyboardActiveTarget;
    if (!target) return;
    if (virtualKeyboardModifiers.ctrl || virtualKeyboardModifiers.alt) {
        virtualKeyboardDispatchKey('Tab', 'Tab');
        return;
    }
    virtualKeyboardInsertText('\t');
}

function moveVirtualKeyboardCaretByDelta(target, deltaX, deltaY) {
    if (!target || typeof target.selectionStart !== 'number') return;

    const value = target.value || '';
    const len = value.length;
    let pos = target.selectionStart;

    if (deltaX) {
        const avgChar = Math.max(4, target.clientWidth / Math.max(len, 1));
        const steps = Math.round(deltaX / avgChar);
        if (steps) {
            pos = Math.max(0, Math.min(len, pos + steps));
        }
    }

    if (deltaY && target.tagName === 'TEXTAREA') {
        const style = getComputedStyle(target);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25 || 16;
        const lineSteps = Math.round(deltaY / lineHeight);
        if (lineSteps) {
            const before = value.substring(0, pos);
            const lineIndex = (before.match(/\n/g) || []).length;
            const lines = value.split('\n');
            const newLine = Math.max(0, Math.min(lines.length - 1, lineIndex + lineSteps));
            const col = pos - before.lastIndexOf('\n') - 1;
            let newPos = 0;
            for (let i = 0; i < newLine; i++) {
                newPos += lines[i].length + 1;
            }
            newPos += Math.min(Math.max(0, col), lines[newLine].length);
            pos = Math.min(len, newPos);
        }
    }

    target.setSelectionRange(pos, pos);
}

function virtualKeyboardGetCharForInsert(btn) {
    const base = btn.dataset.vkChar || '';
    const shifted = btn.dataset.vkShift;
    if (virtualKeyboardModifiers.shift) {
        if (shifted) return shifted;
        if (base.length === 1 && base >= 'a' && base <= 'z') return base.toUpperCase();
    }
    return base;
}

function virtualKeyboardUpdateKeyLabels() {
    const keysRoot = document.getElementById('virtualKeyboardKeys');
    if (!keysRoot) return;

    keysRoot.querySelectorAll('[data-vk-char]').forEach((btn) => {
        btn.textContent = virtualKeyboardGetCharForInsert(btn);
    });
}

function virtualKeyboardUpdateModifierKeyUI() {
    const keysRoot = document.getElementById('virtualKeyboardKeys');
    if (!keysRoot) return;

    keysRoot.querySelectorAll('[data-vk-mod]').forEach((btn) => {
        const mod = btn.dataset.vkMod;
        let on = false;
        if (mod === 'shift') on = virtualKeyboardModifiers.shift;
        else if (mod === 'ctrl') on = virtualKeyboardModifiers.ctrl;
        else if (mod === 'alt') on = virtualKeyboardModifiers.alt;
        btn.dataset.active = on ? 'on' : 'off';
    });

    virtualKeyboardUpdateKeyLabels();
}

function virtualKeyboardHandleCharFromKey(btn) {
    const insert = virtualKeyboardGetCharForInsert(btn);
    if (virtualKeyboardModifiers.ctrl || virtualKeyboardModifiers.alt) {
        const code = insert.length === 1 ? `Key${insert.toUpperCase()}` : insert;
        virtualKeyboardDispatchKey(insert, code);
    } else {
        virtualKeyboardInsertText(insert);
    }
    if (virtualKeyboardModifiers.shift) {
        virtualKeyboardModifiers.shift = false;
        virtualKeyboardUpdateModifierKeyUI();
    }
}

function virtualKeyboardHandleKeyAction(action, value, keyBtn) {
    if (action === 'char' && keyBtn && keyBtn.dataset.vkChar) {
        virtualKeyboardHandleCharFromKey(keyBtn);
        return;
    }
    if (action === 'mod') {
        if (value === 'shift') virtualKeyboardModifiers.shift = !virtualKeyboardModifiers.shift;
        else if (value === 'ctrl') virtualKeyboardModifiers.ctrl = !virtualKeyboardModifiers.ctrl;
        else if (value === 'alt') virtualKeyboardModifiers.alt = !virtualKeyboardModifiers.alt;
        virtualKeyboardUpdateModifierKeyUI();
        return;
    }
    if (action === 'backspace') {
        if (virtualKeyboardModifiers.ctrl || virtualKeyboardModifiers.alt) {
            virtualKeyboardDispatchKey('Backspace', 'Backspace');
        } else {
            virtualKeyboardHandleBackspace();
        }
        return;
    }
    if (action === 'enter') {
        virtualKeyboardHandleEnter();
        return;
    }
    if (action === 'tab') {
        virtualKeyboardHandleTab();
        return;
    }
    if (action === 'hide' || action === 'close') {
        hideVirtualKeyboard();
    }
}

function virtualKeyboardBindSpaceTrackpad(spaceBtn) {
    spaceBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (virtualKeyboardSpaceTrack) return;
        const ptrId = e.pointerId;
        spaceBtn.setPointerCapture(ptrId);
        virtualKeyboardSpaceTrack = {
            btn: spaceBtn,
            ptrId,
            x0: e.clientX,
            y0: e.clientY,
            maxDelta: 0,
            trackpad: false,
            tapTimer: setTimeout(() => {
                if (virtualKeyboardSpaceTrack && !virtualKeyboardSpaceTrack.trackpad) {
                    virtualKeyboardSpaceTrack.tapReady = true;
                }
            }, VK_SPACE_TAP_MS)
        };
        spaceBtn.classList.remove('trackpad-active');
    });

    spaceBtn.addEventListener('pointermove', (e) => {
        const st = virtualKeyboardSpaceTrack;
        if (!st || e.pointerId !== st.ptrId) return;
        const dx = e.clientX - st.x0;
        const dy = e.clientY - st.y0;
        const d = Math.hypot(dx, dy);
        if (d > st.maxDelta) st.maxDelta = d;

        if (!st.trackpad && d > VK_POINTER_SLOP_PX) {
            st.trackpad = true;
            clearTimeout(st.tapTimer);
            st.btn.classList.add('trackpad-active');
            st.lastX = e.clientX;
            st.lastY = e.clientY;
            return;
        }

        if (st.trackpad) {
            const stepX = e.clientX - st.lastX;
            const stepY = e.clientY - st.lastY;
            st.lastX = e.clientX;
            st.lastY = e.clientY;
            moveVirtualKeyboardCaretByDelta(virtualKeyboardActiveTarget, stepX, stepY);
        }
    });

    const endSpacePointer = (e) => {
        const st = virtualKeyboardSpaceTrack;
        if (!st || e.pointerId !== st.ptrId) return;
        clearTimeout(st.tapTimer);
        try {
            st.btn.releasePointerCapture(st.ptrId);
        } catch (err) {
            /* */
        }
        st.btn.classList.remove('trackpad-active');

        if (!st.trackpad && st.maxDelta <= VK_POINTER_SLOP_PX) {
            virtualKeyboardInsertText(' ');
        }
        virtualKeyboardSpaceTrack = null;
    };

    spaceBtn.addEventListener('pointerup', endSpacePointer);
    spaceBtn.addEventListener('pointercancel', endSpacePointer);
}

function virtualKeyboardCreateKey(label, opts = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'virtual-keyboard-key' + (opts.className ? ` ${opts.className}` : '');
    btn.textContent = label;
    if (opts.mod) {
        btn.dataset.vkMod = opts.mod;
        btn.dataset.active = 'off';
    }
    if (opts.action) btn.dataset.vkAction = opts.action;
    if (opts.value) btn.dataset.vkValue = opts.value;
    if (opts.char) btn.dataset.vkChar = opts.char;
    if (opts.shift) btn.dataset.vkShift = opts.shift;
    return btn;
}

function virtualKeyboardAppendSpecKey(rowEl, spec) {
    if (spec.char) {
        const btn = virtualKeyboardCreateKey(spec.char, {
            action: 'char',
            char: spec.char,
            shift: spec.shift,
            className: 'virtual-keyboard-key--std'
        });
        rowEl.appendChild(btn);
        return btn;
    }

    const kind = spec.special;
    if (kind === 'tab') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            action: 'tab',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--tab'
        }));
        return;
    }
    if (kind === 'backspace') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            action: 'backspace',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--backspace'
        }));
        return;
    }
    if (kind === 'shift') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            mod: 'shift',
            action: 'mod',
            value: 'shift',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--shift'
        }));
        return;
    }
    if (kind === 'enter') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            action: 'enter',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--enter'
        }));
        return;
    }
    if (kind === 'close') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            action: 'close',
            className: 'virtual-keyboard-key--std virtual-keyboard-key--close'
        }));
        return;
    }
    if (kind === 'ctrl') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            mod: 'ctrl',
            action: 'mod',
            value: 'ctrl',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--ctrl'
        }));
        return;
    }
    if (kind === 'alt') {
        rowEl.appendChild(virtualKeyboardCreateKey(spec.label, {
            mod: 'alt',
            action: 'mod',
            value: 'alt',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--alt'
        }));
        return;
    }
    if (kind === 'space') {
        const spaceBtn = virtualKeyboardCreateKey(spec.label, {
            action: 'space',
            className: 'virtual-keyboard-key--wide virtual-keyboard-key--space'
        });
        virtualKeyboardBindSpaceTrackpad(spaceBtn);
        rowEl.appendChild(spaceBtn);
    }
}

function virtualKeyboardBuildLayout() {
    const root = document.getElementById('virtualKeyboardKeys');
    if (!root || root.dataset.vkBuilt === '4') return;
    root.dataset.vkBuilt = '4';
    root.innerHTML = '';

    VK_LAYOUT_ROWS.forEach((rowDef) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'virtual-keyboard-row' + (rowDef.rowClass ? ` ${rowDef.rowClass}` : '');
        rowDef.keys.forEach((spec) => virtualKeyboardAppendSpecKey(rowEl, spec));
        root.appendChild(rowEl);
    });

    virtualKeyboardUpdateKeyLabels();

    root.addEventListener('click', (e) => {
        const key = e.target.closest('.virtual-keyboard-key');
        if (!key || key.dataset.vkAction === 'space') return;
        e.preventDefault();
        const action = key.dataset.vkAction;
        const value = key.dataset.vkValue || key.dataset.vkChar;
        virtualKeyboardHandleKeyAction(action, value, key);
    });

    root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.virtual-keyboard-key')) {
            e.preventDefault();
        }
    }, true);
}

function virtualKeyboardPlaceDesktopDefault(modal) {
    if (!modal || !isVirtualKeyboardDesktopChrome()) return;
    if (modal.hasAttribute('data-modal-moved')) return;

    requestAnimationFrame(() => {
        if (modal.classList.contains('hidden')) return;

        const rect = modal.getBoundingClientRect();
        const h = rect.height || 260;
        const trueInsetTop = getModalTrueInsetTop();
        const targetTop = window.innerHeight - h - 24;
        const centerY = window.innerHeight / 2;
        const offsetY = (targetTop + h / 2) - centerY - (0.5 * trueInsetTop) + getDesktopModalTopBias();

        // clearModalPixelAnchor, setModalOffsetPx: public/scripts/comp/modalUtils.js
        clearModalPixelAnchor(modal);
        setModalOffsetPx(modal, 0, offsetY, { snap: true, settle: false });
    });
}

function virtualKeyboardEnsureDesktopWindowReady(modal) {
    if (!modal) return;
    modal.classList.add('active-window');
    // bringModalToFront: public/scripts/comp/modalUtils.js
    bringModalToFront(modal);
}

function showVirtualKeyboard() {
    const modal = getVirtualKeyboardModal();
    if (!modal || !virtualKeyboardEnabled) return;

    virtualKeyboardVisible = true;

    if (isVirtualKeyboardDesktopChrome()) {
        modal.classList.remove('virtual-keyboard--docked');
        clearVirtualKeyboardDockPadding();
        const wasHidden = modal.classList.contains('hidden');
        if (wasHidden) {
            openModal(modal);
            virtualKeyboardEnsureDesktopWindowReady(modal);
            if (!modal.hasAttribute('data-modal-moved')) {
                virtualKeyboardPlaceDesktopDefault(modal);
            }
        } else {
            virtualKeyboardEnsureDesktopWindowReady(modal);
        }
        requestAnimationFrame(() => updateVirtualKeyboardWideLayout());
    } else {
        modal.classList.add('virtual-keyboard--docked');
        modal.classList.remove('hidden');
        modal.classList.remove('opening', 'closing');
        requestAnimationFrame(() => {
            updateVirtualKeyboardDockPadding();
            updateVirtualKeyboardWideLayout();
        });
    }
}

function hideVirtualKeyboard() {
    const modal = getVirtualKeyboardModal();
    virtualKeyboardVisible = false;
    detachVirtualKeyboardSuppress();
    virtualKeyboardActiveTarget = null;

    if (!modal) return;

    if (isVirtualKeyboardDesktopChrome()) {
        if (!modal.classList.contains('hidden')) {
            closeModal(modal);
        }
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('virtual-keyboard--docked');
        clearVirtualKeyboardDockPadding();
    }
}

function onVirtualKeyboardFocusIn(e) {
    if (!virtualKeyboardEnabled) return;
    const el = e.target;
    if (!isVirtualKeyboardEligible(el)) return;

    virtualKeyboardActiveTarget = el;
    attachVirtualKeyboardSuppress(el);
    showVirtualKeyboard();
}

function onVirtualKeyboardFocusOut() {
    setTimeout(() => {
        const modal = getVirtualKeyboardModal();
        if (modal && (modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing'))) {
            return;
        }
        const active = document.activeElement;

        if (active && isVirtualKeyboardEligible(active)) {
            virtualKeyboardActiveTarget = active;
            attachVirtualKeyboardSuppress(active);
            return;
        }
        if (modal && (modal.contains(active) || active && active.closest('.virtual-keyboard-keys'))) {
            return;
        }
        if (active && active.closest('#virtualKeyboardModal .virtual-keyboard-drag-header')) {
            return;
        }
        hideVirtualKeyboard();
    }, 0);
}

function setVirtualKeyboardEnabled(on) {
    virtualKeyboardEnabled = on === true;
    document.documentElement.classList.toggle('virtual-keyboard-enabled', virtualKeyboardEnabled);
    try {
        localStorage.setItem(VK_STORAGE_KEY, virtualKeyboardEnabled ? 'true' : 'false');
    } catch (e) {
        /* */
    }
    if (!virtualKeyboardEnabled) {
        hideVirtualKeyboard();
    }
}

function syncVirtualKeyboardPresentation() {
    if (!virtualKeyboardEnabled || !virtualKeyboardVisible) return;

    const modal = getVirtualKeyboardModal();
    const target = virtualKeyboardActiveTarget;
    const wasDesktop = !modal || !modal.classList.contains('virtual-keyboard--docked');
    const wantDesktop = isVirtualKeyboardDesktopChrome();

    if (wasDesktop === wantDesktop) {
        if (!wantDesktop) updateVirtualKeyboardDockPadding();
        updateVirtualKeyboardWideLayout();
        return;
    }

    hideVirtualKeyboard();
    if (target && isVirtualKeyboardEligible(target)) {
        virtualKeyboardActiveTarget = target;
        target.focus();
        attachVirtualKeyboardSuppress(target);
        showVirtualKeyboard();
    }
}

let virtualKeyboardResizeTimer = null;

function initVirtualKeyboard() {
    if (virtualKeyboardInitialized) return;
    virtualKeyboardInitialized = true;

    virtualKeyboardBuildLayout();

    virtualKeyboardEnabled = readVirtualKeyboardEnabledFromStorage();
    document.documentElement.classList.toggle('virtual-keyboard-enabled', virtualKeyboardEnabled);

    document.addEventListener('focusin', onVirtualKeyboardFocusIn, true);
    document.addEventListener('focusout', onVirtualKeyboardFocusOut, true);

    const modal = getVirtualKeyboardModal();
    const dragHeader = modal && modal.querySelector('.virtual-keyboard-drag-header');
    if (dragHeader) {
        dragHeader.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
    }
    if (modal && typeof ResizeObserver !== 'undefined') {
        virtualKeyboardLayoutObserver = new ResizeObserver(() => {
            updateVirtualKeyboardWideLayout();
            if (modal.classList.contains('virtual-keyboard--docked') && virtualKeyboardVisible) {
                updateVirtualKeyboardDockPadding();
            }
        });
        virtualKeyboardLayoutObserver.observe(modal);
    }

    window.addEventListener('resize', () => {
        clearTimeout(virtualKeyboardResizeTimer);
        virtualKeyboardResizeTimer = setTimeout(() => {
            syncVirtualKeyboardPresentation();
            if (!isVirtualKeyboardDesktopChrome() && virtualKeyboardVisible) {
                updateVirtualKeyboardDockPadding();
            }
            updateVirtualKeyboardWideLayout();
        }, 200);
    });

    updateVirtualKeyboardWideLayout();
}
