// MeletonFX calculator window.
// Shell wiring (script tag, Start menu) is a separate issue. This file only opens the window.
// openModal / bringModalToFront / restoreMinimizedModal / closeModal: public/scripts/comp/modalUtils.js
// registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js

const DESKTOP_CALCULATOR_MODAL_ID = 'desktopCalculatorModal';
const DESKTOP_CALCULATOR_MAX_DIGITS = 12;

const DESKTOP_CALCULATOR_KEYS = [
    [
        { key: 'clear', label: 'C', title: 'Clear' },
        { key: 'sign', label: '\u00b1', title: 'Toggle sign' },
        { key: 'backspace', label: '\u232b', title: 'Backspace' },
        { key: '/', label: '\u00f7', title: 'Divide' }
    ],
    [
        { key: '7', label: '7', title: '7' },
        { key: '8', label: '8', title: '8' },
        { key: '9', label: '9', title: '9' },
        { key: '*', label: '\u00d7', title: 'Multiply' }
    ],
    [
        { key: '4', label: '4', title: '4' },
        { key: '5', label: '5', title: '5' },
        { key: '6', label: '6', title: '6' },
        { key: '-', label: '\u2212', title: 'Subtract' }
    ],
    [
        { key: '1', label: '1', title: '1' },
        { key: '2', label: '2', title: '2' },
        { key: '3', label: '3', title: '3' },
        { key: '+', label: '+', title: 'Add' }
    ],
    [
        { key: '0', label: '0', title: '0' },
        { key: '.', label: '.', title: 'Decimal' },
        { key: '=', label: '=', title: 'Equals', primary: true }
    ]
];

let calcDisplay = '0';
let calcAcc = null;
let calcOp = null;
let calcLast = null;
let calcFresh = true;
let calcError = false;
let calcKeyboardWired = false;

function openDesktopCalculator() {
    const modal = ensureDesktopCalculatorModal();
    if (modal.classList.contains('minimised')) {
        // restoreMinimizedModal: public/scripts/comp/modalUtils.js
        restoreMinimizedModal(modal);
    }
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
        // openModal: public/scripts/comp/modalUtils.js
        openModal(modal);
    }
    // bringModalToFront: public/scripts/comp/modalUtils.js
    bringModalToFront(modal);
}

const ensureDesktopCalculatorModal = function () {
    let modal = document.getElementById(DESKTOP_CALCULATOR_MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = DESKTOP_CALCULATOR_MODAL_ID;
    modal.className = 'modal resizeable-window hidden';
    modal.dataset.windowIdentifier = 'desktopCalculator';
    modal.dataset.windowDefaultWidth = '280';
    modal.dataset.windowMinWidth = '240';
    modal.dataset.windowMaxWidth = '480';
    modal.dataset.windowMaxHeight = '640';
    modal.style.flexDirection = 'column';

    const title = document.createElement('div');
    title.className = 'modal-window-title';
    const titleMain = document.createElement('div');
    titleMain.className = 'modal-window-title-main';
    const titleIcon = document.createElement('i');
    titleIcon.className = 'fas fa-calculator';
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.textContent = 'Calculator';
    titleMain.appendChild(titleIcon);
    titleMain.appendChild(titleText);
    title.appendChild(titleMain);

    const focusOverlay = document.createElement('div');
    focusOverlay.className = 'modal-focus-overlay';

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.className = 'btn-secondary minimize-btn btn-small';
    minimizeBtn.title = 'Minimize';
    const minimizeIcon = document.createElement('i');
    minimizeIcon.className = 'fa-regular fa-window-minimize';
    minimizeIcon.setAttribute('aria-hidden', 'true');
    minimizeBtn.appendChild(minimizeIcon);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'desktopCalculatorCloseBtn';
    closeBtn.className = 'btn-danger close-btn btn-small';
    closeBtn.title = 'Close';
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-regular fa-xmark-large';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(closeIcon);
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    content.style.flex = '1 1 auto';
    content.style.height = 'auto';
    content.style.minHeight = '0';
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.flex = '1 1 auto';
    body.style.minHeight = '0';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    const pad = document.createElement('div');
    pad.className = 'form-col';
    pad.id = 'desktopCalculatorPad';
    pad.style.flex = '1 1 auto';
    pad.style.minHeight = '0';

    const readout = document.createElement('div');
    readout.id = 'desktopCalculatorDisplay';
    readout.className = 'form-control';
    readout.style.flex = '0 0 auto';
    readout.setAttribute('role', 'status');
    readout.setAttribute('aria-live', 'polite');
    readout.setAttribute('aria-atomic', 'true');
    readout.style.textAlign = 'right';
    readout.textContent = calcDisplay;
    pad.appendChild(readout);

    DESKTOP_CALCULATOR_KEYS.forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'form-row';
        rowEl.style.flex = '1 1 auto';
        rowEl.style.alignItems = 'stretch';
        rowEl.style.minHeight = '32px';
        row.forEach((spec) => {
            const group = document.createElement('div');
            group.className = 'form-group';
            group.style.minHeight = '0';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = spec.primary ? 'btn-primary' : 'btn-secondary';
            button.style.flex = '1 1 auto';
            button.style.width = '100%';
            button.style.minHeight = '32px';
            button.dataset.calcKey = spec.key;
            button.title = spec.title;
            button.textContent = spec.label;
            group.appendChild(button);
            rowEl.appendChild(group);
        });
        pad.appendChild(rowEl);
    });

    pad.addEventListener('mousedown', (ev) => {
        const button = ev.target.closest('button');
        if (!button || !pad.contains(button)) return;
        ev.preventDefault();
    });
    pad.addEventListener('click', (ev) => {
        const button = ev.target.closest('button[data-calc-key]');
        if (!button || !pad.contains(button)) return;
        applyDesktopCalculatorKey(button.dataset.calcKey);
    });

    body.appendChild(pad);
    content.appendChild(body);
    modal.appendChild(title);
    modal.appendChild(focusOverlay);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);
    wireDesktopCalculatorKeyboard();
    desktopAppApplyContentHeight(modal);
    return modal;
};

function desktopAppApplyContentHeight(modal) {
    // beginModalLayoutMeasure / endModalLayoutMeasure: public/scripts/comp/modalUtils.js
    const width = parseInt(modal.dataset.windowDefaultWidth, 10);
    const state = beginModalLayoutMeasure(modal);
    const content = modal.querySelector('.modal-content');
    const freeze = [modal];
    if (content) {
        freeze.push(content);
        content.querySelectorAll('.modal-body, .form-col, .form-section, .form-row, .form-group, .form-control, button, h2, h3').forEach((node) => {
            freeze.push(node);
        });
    }
    const saved = freeze.map((node) => ({
        node: node,
        flex: node.style.flex,
        height: node.style.height,
        maxHeight: node.style.maxHeight
    }));
    const previousWidth = modal.style.width;
    if (width > 0) modal.style.width = width + 'px';
    saved.forEach((item) => {
        item.node.style.flex = '0 0 auto';
        item.node.style.height = 'auto';
        item.node.style.maxHeight = 'none';
    });
    const hug = Math.ceil(modal.getBoundingClientRect().height);
    if (previousWidth) modal.style.width = previousWidth;
    else modal.style.removeProperty('width');
    saved.forEach((item) => {
        if (item.flex) item.node.style.flex = item.flex;
        else item.node.style.removeProperty('flex');
        if (item.height) item.node.style.height = item.height;
        else item.node.style.removeProperty('height');
        if (item.maxHeight) item.node.style.maxHeight = item.maxHeight;
        else item.node.style.removeProperty('max-height');
    });
    endModalLayoutMeasure(modal, state);
    if (hug >= 80) {
        modal.dataset.windowDefaultHeight = String(hug);
        modal.dataset.windowMinHeight = String(hug);
    }
}

const wireDesktopCalculatorKeyboard = function () {
    if (calcKeyboardWired) return;
    calcKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'desktopCalculator.keydown',
        handler: handleDesktopCalculatorKeydown,
        type: 'whenFocused',
        modalId: DESKTOP_CALCULATOR_MODAL_ID,
        priority: 80,
        critical: true,
        showInOverlay: false
    });
};

const desktopCalculatorForeignTextTarget = function (ev) {
    const target = ev.target;
    if (!target || !target.tagName) return false;
    const modal = document.getElementById(DESKTOP_CALCULATOR_MODAL_ID);
    if (modal && modal.contains(target)) return false;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        const type = (target.type || 'text').toLowerCase();
        if (type === 'button' || type === 'submit' || type === 'reset' || type === 'checkbox' || type === 'radio') {
            return false;
        }
        return true;
    }
    return !!target.isContentEditable;
};

const handleDesktopCalculatorKeydown = function (ev) {
    if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (desktopCalculatorForeignTextTarget(ev)) return;
    const key = ev.key;
    let calcKey = null;
    if (key >= '0' && key <= '9') calcKey = key;
    else if (key === '.' || key === ',') calcKey = '.';
    else if (key === '+' || key === '-' || key === '*' || key === '/') calcKey = key;
    else if (key === 'x' || key === 'X') calcKey = '*';
    else if (key === 'Enter' || key === '=') calcKey = '=';
    else if (key === 'Backspace') calcKey = 'backspace';
    else if (key === 'Escape' || key === 'Delete') calcKey = 'clear';
    else if (key === 'F9') calcKey = 'sign';
    if (!calcKey) return;
    ev.preventDefault();
    applyDesktopCalculatorKey(calcKey);
    return true;
};

const applyDesktopCalculatorKey = function (key) {
    if (key >= '0' && key <= '9') calcInputDigit(key);
    else if (key === '.') calcInputDecimal();
    else if (key === '+' || key === '-' || key === '*' || key === '/') calcApplyOperator(key);
    else if (key === '=') calcEquals();
    else if (key === 'clear') calcReset();
    else if (key === 'backspace') calcBackspace();
    else if (key === 'sign') calcToggleSign();
};

const calcRender = function () {
    const readout = document.getElementById('desktopCalculatorDisplay');
    if (readout) readout.textContent = calcDisplay;
};

const calcReset = function () {
    calcDisplay = '0';
    calcAcc = null;
    calcOp = null;
    calcLast = null;
    calcFresh = true;
    calcError = false;
    calcRender();
};

const calcFail = function () {
    calcDisplay = 'Error';
    calcAcc = null;
    calcOp = null;
    calcLast = null;
    calcFresh = true;
    calcError = true;
    calcRender();
};

const calcDigitCount = function (text) {
    return String(text).replace(/^-/, '').replace('.', '').length;
};

const calcInputDigit = function (digit) {
    if (calcError) calcReset();
    if (calcFresh) {
        calcDisplay = digit;
        calcFresh = false;
    } else if (calcDisplay === '0') {
        calcDisplay = digit;
    } else if (calcDisplay === '-0') {
        calcDisplay = '-' + digit;
    } else if (calcDigitCount(calcDisplay) >= DESKTOP_CALCULATOR_MAX_DIGITS) {
        return;
    } else {
        calcDisplay += digit;
    }
    calcRender();
};

const calcInputDecimal = function () {
    if (calcError) calcReset();
    if (calcFresh) {
        calcDisplay = '0.';
        calcFresh = false;
    } else if (calcDisplay.indexOf('.') === -1) {
        calcDisplay += '.';
    }
    calcRender();
};

const calcBackspace = function () {
    if (calcError) {
        calcReset();
        return;
    }
    if (calcFresh) return;
    const negativeOne = calcDisplay.length === 2 && calcDisplay.charAt(0) === '-' && calcDisplay.charAt(1) !== '.';
    if (calcDisplay === '-0' || calcDisplay.length <= 1 || negativeOne) {
        calcDisplay = '0';
        calcFresh = true;
    } else {
        calcDisplay = calcDisplay.slice(0, -1);
        if (calcDisplay === '-' || calcDisplay === '') calcDisplay = '0';
    }
    calcRender();
};

const calcToggleSign = function () {
    if (calcError) return;
    if (calcFresh && calcOp) {
        calcDisplay = '-0';
        calcFresh = false;
        calcRender();
        return;
    }
    if (calcFresh && !calcOp) {
        if (calcDisplay === '0') {
            calcDisplay = '-0';
            calcFresh = false;
            calcRender();
            return;
        }
        calcDisplay = calcDisplay.charAt(0) === '-' ? calcDisplay.slice(1) : '-' + calcDisplay;
        const negated = parseFloat(calcDisplay);
        if (Number.isFinite(negated)) calcAcc = negated;
        calcRender();
        return;
    }
    if (calcDisplay === '-0') calcDisplay = '0';
    else if (calcDisplay === '-0.') calcDisplay = '0.';
    else if (calcDisplay.charAt(0) === '-') calcDisplay = calcDisplay.slice(1);
    else if (calcDisplay === '0') calcDisplay = '-0';
    else if (calcDisplay === '0.') calcDisplay = '-0.';
    else calcDisplay = '-' + calcDisplay;
    calcRender();
};

const calcCompute = function (left, op, right) {
    if (op === '+') return left + right;
    if (op === '-') return left - right;
    if (op === '*') return left * right;
    if (op === '/') {
        if (right === 0) return null;
        return left / right;
    }
    return right;
};

const calcFormat = function (n) {
    if (!Number.isFinite(n)) return null;
    if (Object.is(n, -0)) return '0';
    const abs = Math.abs(n);
    let text;
    if (abs !== 0 && (abs >= 1e12 || abs < 1e-8)) {
        text = n.toPrecision(8);
    } else {
        const rounded = Math.round(n * 1e12) / 1e12;
        text = rounded.toFixed(12).replace(/\.?0+$/, '');
    }
    if (text === '-0') return '0';
    return text;
};

const calcShowNumber = function (n) {
    const formatted = calcFormat(n);
    if (formatted === null) {
        calcFail();
        return false;
    }
    calcDisplay = formatted;
    calcAcc = n;
    return true;
};

const calcApplyOperator = function (nextOp) {
    if (calcError) return;
    const value = parseFloat(calcDisplay);
    if (!Number.isFinite(value)) {
        calcFail();
        return;
    }
    if (calcOp && !calcFresh) {
        const result = calcCompute(calcAcc, calcOp, value);
        if (result === null || !calcShowNumber(result)) {
            if (result === null) calcFail();
            return;
        }
        calcLast = value;
    } else {
        calcAcc = value;
        if (calcLast === null) calcLast = value;
    }
    calcOp = nextOp;
    calcFresh = true;
    calcRender();
};

const calcEquals = function () {
    if (calcError) return;
    if (!calcOp || calcAcc === null) {
        calcFresh = true;
        return;
    }
    const value = calcFresh && calcLast !== null ? calcLast : parseFloat(calcDisplay);
    if (!Number.isFinite(value)) {
        calcFail();
        return;
    }
    if (!calcFresh) calcLast = value;
    const result = calcCompute(calcAcc, calcOp, value);
    if (result === null || !calcShowNumber(result)) {
        if (result === null) calcFail();
        return;
    }
    calcOp = null;
    calcFresh = true;
    calcRender();
};
