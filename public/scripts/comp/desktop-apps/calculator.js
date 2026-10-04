// MeletonFX calculator window: Standard, Scientific, and Programmer keypads plus a history tape.
// Shell wiring (script tag, Start menu) is a separate issue. This file only opens the window.
// MCP get_calculator / set_calculator reach readDesktopCalculatorForAgent / applyDesktopCalculatorAgentAction
// through public/scripts/comp/agentClientBridge.js.
// openModal / bringModalToFront / restoreMinimizedModal / closeModal / isModalMaximized: public/scripts/comp/modalUtils.js
// registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
// Layout, keypad-per-mode visibility, 2nd labels, and the tape column: public/css/desktop-apps/desktopAppWindows.css

const DESKTOP_CALCULATOR_MODAL_ID = 'desktopCalculatorModal';
const DESKTOP_CALCULATOR_STORAGE_KEY = 'desktopCalculator';
const DESKTOP_CALCULATOR_MAX_DIGITS = 16;
const DESKTOP_CALCULATOR_TAPE_MAX = 200;
const DESKTOP_CALCULATOR_EXPR_MAX = 500;
const DESKTOP_CALCULATOR_TOKENS_MAX = 400;
const DESKTOP_CALCULATOR_MODES = ['standard', 'scientific', 'programmer'];
const DESKTOP_CALCULATOR_ANGLES = ['deg', 'rad', 'grad'];
const DESKTOP_CALCULATOR_WORDS = [64, 32, 16, 8];
const DESKTOP_CALCULATOR_WORD_NAMES = { 64: 'QWORD', 32: 'DWORD', 16: 'WORD', 8: 'BYTE' };
const DESKTOP_CALCULATOR_BASES = [[16, 'HEX'], [10, 'DEC'], [8, 'OCT'], [2, 'BIN']];
const DESKTOP_CALCULATOR_BASE_PREFIX = { 16: '0x', 8: '0o', 2: '0b', 10: '' };
const DESKTOP_CALCULATOR_MODE_ICONS = {
    standard: ['fas fa-calculator', 'Standard'],
    scientific: ['fas fa-square-root-variable', 'Scientific'],
    programmer: ['fas fa-code', 'Programmer']
};

const CALC_ERR_DIV0 = 'Cannot divide by zero';
const CALC_ERR_INVALID = 'Invalid input';
const CALC_ERR_OVERFLOW = 'Overflow';

// label/title per key. key2/label2/title2 is the 2nd function on the same button.
const DESKTOP_CALCULATOR_KEY_SPECS = {
    '.': { label: '.', title: 'Decimal' },
    '+': { label: '+', title: 'Add' },
    '-': { label: '\u2212', title: 'Subtract' },
    '*': { label: '\u00d7', title: 'Multiply' },
    '/': { label: '\u00f7', title: 'Divide' },
    '=': { label: '=', title: 'Equals', primary: true },
    '(': { label: '(', title: 'Open parenthesis' },
    ')': { label: ')', title: 'Close parenthesis' },
    mod: { label: 'mod', title: 'Modulo' },
    pow: { label: 'x\u02b8', title: 'x to the power of y', key2: 'yroot', label2: '\u02b8\u221ax', title2: 'y root of x' },
    clear: { label: 'C', title: 'Clear' },
    ce: { label: 'CE', title: 'Clear entry' },
    backspace: { label: '\u232b', title: 'Backspace' },
    sign: { label: '\u00b1', title: 'Toggle sign' },
    percent: { label: '%', title: 'Percent' },
    sqr: { label: 'x\u00b2', title: 'Square', key2: 'cube', label2: 'x\u00b3', title2: 'Cube' },
    sqrt: { label: '\u221ax', title: 'Square root', key2: 'cbrt', label2: '\u221bx', title2: 'Cube root' },
    recip: { label: '1/x', title: 'Reciprocal' },
    abs: { label: '|x|', title: 'Absolute value' },
    fact: { label: 'n!', title: 'Factorial' },
    sin: { label: 'sin', title: 'Sine', key2: 'asin', label2: 'sin\u207b\u00b9', title2: 'Inverse sine' },
    cos: { label: 'cos', title: 'Cosine', key2: 'acos', label2: 'cos\u207b\u00b9', title2: 'Inverse cosine' },
    tan: { label: 'tan', title: 'Tangent', key2: 'atan', label2: 'tan\u207b\u00b9', title2: 'Inverse tangent' },
    pow10: { label: '10\u02e3', title: 'Ten to the power of x', key2: 'pow2', label2: '2\u02e3', title2: 'Two to the power of x' },
    log: { label: 'log', title: 'Log base 10', key2: 'log2', label2: 'log\u2082', title2: 'Log base 2' },
    ln: { label: 'ln', title: 'Natural log', key2: 'exp', label2: 'e\u02e3', title2: 'e to the power of x' },
    pi: { label: '\u03c0', title: 'Pi' },
    e: { label: 'e', title: "Euler's number" },
    mc: { label: 'MC', title: 'Memory clear' },
    mr: { label: 'MR', title: 'Memory recall' },
    mplus: { label: 'M+', title: 'Memory add' },
    mminus: { label: 'M\u2212', title: 'Memory subtract' },
    ms: { label: 'MS', title: 'Memory store' },
    second: { label: '2nd', title: 'Second functions', toggle: true },
    angle: { label: 'DEG', title: 'Angle unit (degrees, radians, gradians)' },
    bits: { label: 'QWORD', title: 'Word size' },
    and: { label: 'AND', title: 'Bitwise AND' },
    or: { label: 'OR', title: 'Bitwise OR' },
    xor: { label: 'XOR', title: 'Bitwise XOR' },
    not: { label: 'NOT', title: 'Bitwise NOT' },
    nand: { label: 'NAND', title: 'Bitwise NAND' },
    nor: { label: 'NOR', title: 'Bitwise NOR' },
    lsh: { label: '<<', title: 'Left shift' },
    rsh: { label: '>>', title: 'Right shift (arithmetic)' }
};
'0123456789ABCDEF'.split('').forEach((digit) => {
    DESKTOP_CALCULATOR_KEY_SPECS[digit] = { label: digit, title: digit };
});

const DESKTOP_CALCULATOR_MEMORY_ROW = ['mc', 'mr', 'mplus', 'mminus', 'ms'];
// The last programmer row is F and a wide equals (desktopAppWindows.css).
const DESKTOP_CALCULATOR_LAYOUTS = {
    standard: [
        DESKTOP_CALCULATOR_MEMORY_ROW,
        ['percent', 'ce', 'clear', 'backspace'],
        ['recip', 'sqr', 'sqrt', '/'],
        ['7', '8', '9', '*'],
        ['4', '5', '6', '-'],
        ['1', '2', '3', '+'],
        ['sign', '0', '.', '=']
    ],
    scientific: [
        DESKTOP_CALCULATOR_MEMORY_ROW,
        ['second', 'angle', 'sin', 'cos', 'tan'],
        ['pi', 'e', 'clear', 'ce', 'backspace'],
        ['sqr', 'recip', 'abs', 'fact', 'mod'],
        ['sqrt', '(', ')', 'percent', '/'],
        ['pow', '7', '8', '9', '*'],
        ['pow10', '4', '5', '6', '-'],
        ['log', '1', '2', '3', '+'],
        ['ln', 'sign', '0', '.', '=']
    ],
    programmer: [
        ['bits', 'and', 'or', 'xor', 'not'],
        ['nand', 'nor', 'lsh', 'rsh', 'mod'],
        ['A', '(', ')', 'clear', 'backspace'],
        ['B', '7', '8', '9', '/'],
        ['C', '4', '5', '6', '*'],
        ['D', '1', '2', '3', '-'],
        ['E', 'sign', '0', 'ce', '+'],
        ['F', '=']
    ]
};

// Keys reachable in each mode (keyboard is limited to what the visible keypad offers).
const DESKTOP_CALCULATOR_MODE_KEYS = {};
DESKTOP_CALCULATOR_MODES.forEach((mode) => {
    const keys = new Set();
    DESKTOP_CALCULATOR_LAYOUTS[mode].forEach((row) => row.forEach((key) => {
        keys.add(key);
        if (DESKTOP_CALCULATOR_KEY_SPECS[key].key2) keys.add(DESKTOP_CALCULATOR_KEY_SPECS[key].key2);
    }));
    DESKTOP_CALCULATOR_MODE_KEYS[mode] = keys;
});

const DESKTOP_CALCULATOR_KEYBOARD = {
    '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/', '(': '(', ')': ')', '.': '.', ',': '.',
    Enter: '=', '=': '=', Backspace: 'backspace', Escape: 'clear', Delete: 'ce', F9: 'sign'
};
const DESKTOP_CALCULATOR_KEYBOARD_FLOAT = {
    '%': 'percent', '^': 'pow', '!': 'fact', '@': 'sqrt', q: 'sqr', r: 'recip',
    s: 'sin', o: 'cos', t: 'tan', l: 'log', n: 'ln', p: 'pi'
};
const DESKTOP_CALCULATOR_KEYBOARD_INT = { '%': 'mod', '&': 'and', '|': 'or', '^': 'xor', '~': 'not', '<': 'lsh', '>': 'rsh' };

const DESKTOP_CALCULATOR_OP_TEXT = {
    '+': '+', '-': '\u2212', '*': '\u00d7', '/': '\u00f7', mod: 'mod', pow: '^', yroot: 'yroot',
    and: 'AND', or: 'OR', xor: 'XOR', nand: 'NAND', nor: 'NOR', lsh: '<<', rsh: '>>'
};
// Standard is immediate execution (Windows): every binary op is one left-to-right level.
const DESKTOP_CALCULATOR_STANDARD_PREC = { '+': 1, '-': 1, '*': 1, '/': 1, neg: 3 };
const DESKTOP_CALCULATOR_FLOAT_PREC = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, neg: 3, pow: 4, yroot: 4 };
const DESKTOP_CALCULATOR_INT_PREC = {
    or: 1, nor: 1, xor: 2, and: 3, nand: 3, lsh: 4, rsh: 4, '+': 5, '-': 5, '*': 6, '/': 6, mod: 6, neg: 7, not: 7
};
const DESKTOP_CALCULATOR_RIGHT_ASSOC = new Set(['pow', 'yroot']);
const DESKTOP_CALCULATOR_FN_PREC = 9;

const DESKTOP_CALCULATOR_UNARY_LABELS = {
    neg: 'negate', not: 'NOT', sqr: 'sqr', cube: 'cube', sqrt: '\u221a', cbrt: '\u221b', recip: '1/', abs: 'abs',
    fact: 'fact', sin: 'sin', cos: 'cos', tan: 'tan', asin: 'sin\u207b\u00b9', acos: 'cos\u207b\u00b9',
    atan: 'tan\u207b\u00b9', pow10: '10^', pow2: '2^', exp: 'e^', log: 'log', log2: 'log\u2082', ln: 'ln'
};

const DESKTOP_CALCULATOR_WORD_OPS = {
    mod: 'mod', and: 'and', or: 'or', xor: 'xor', nand: 'nand', nor: 'nor',
    shl: 'lsh', lsh: 'lsh', shr: 'rsh', rsh: 'rsh', yroot: 'yroot'
};

const desktopCalc = {
    loaded: false,
    mode: 'standard',
    angle: 'deg',
    base: 10,
    bits: 64,
    second: false,
    entry: '0',
    value: 0,
    label: null,
    typing: false,
    live: true,
    tokens: [],
    shownExpr: '',
    repeat: null,
    error: null,
    memory: null,
    tape: [],
    nextId: 1
};
let desktopCalcEls = null;
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

const calcCreateButton = function (className, title, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    if (iconClass) {
        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
    }
    return button;
};

const calcBuildKeyGroup = function (key) {
    const spec = DESKTOP_CALCULATOR_KEY_SPECS[key];
    const group = document.createElement('div');
    group.className = 'form-group';
    let className = 'btn-secondary';
    if (spec.primary) className = 'btn-primary';
    else if (spec.toggle) className = 'btn-secondary btn-toggle';
    const button = calcCreateButton(className, spec.title, null);
    button.dataset.calcKey = key;
    if (spec.toggle) button.dataset.state = 'off';
    if (spec.key2) {
        button.dataset.calcKey2 = spec.key2;
        button.title = spec.title + ' (2nd: ' + spec.title2 + ')';
        const first = document.createElement('span');
        first.textContent = spec.label;
        const second = document.createElement('span');
        second.textContent = spec.label2;
        button.appendChild(first);
        button.appendChild(second);
    } else {
        button.textContent = spec.label;
    }
    group.appendChild(button);
    return group;
};

const calcBuildPad = function (mode) {
    const pad = document.createElement('div');
    pad.className = 'form-col';
    pad.dataset.calcPad = mode;
    DESKTOP_CALCULATOR_LAYOUTS[mode].forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'form-row';
        row.forEach((key) => rowEl.appendChild(calcBuildKeyGroup(key)));
        pad.appendChild(rowEl);
    });
    return pad;
};

const ensureDesktopCalculatorModal = function () {
    let modal = document.getElementById(DESKTOP_CALCULATOR_MODAL_ID);
    if (modal) return modal;
    calcEnsureLoaded();

    modal = document.createElement('div');
    modal.id = DESKTOP_CALCULATOR_MODAL_ID;
    modal.className = 'modal resizeable-window toolbar-visible hidden';
    modal.dataset.windowIdentifier = 'desktopCalculator';
    modal.dataset.windowDefaultWidth = '360';
    modal.dataset.windowMinWidth = '300';
    modal.dataset.windowMaxWidth = '960';
    modal.dataset.windowMaxHeight = '900';
    modal.dataset.calcMode = desktopCalc.mode;

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

    const toolbar = document.createElement('div');
    toolbar.className = 'modal-window-title-toolbar';
    const modeGroup = document.createElement('div');
    modeGroup.className = 'button-group';
    const modeButtons = DESKTOP_CALCULATOR_MODES.map((mode) => {
        const icon = DESKTOP_CALCULATOR_MODE_ICONS[mode];
        const button = calcCreateButton('btn-secondary btn-toggle toolbar-input-segment', icon[1], icon[0]);
        button.dataset.calcModeBtn = mode;
        modeGroup.appendChild(button);
        return button;
    });
    const tapeBtn = calcCreateButton('btn-secondary btn-toggle', 'History', 'fas fa-clock-rotate-left');
    tapeBtn.id = 'desktopCalculatorTapeBtn';
    tapeBtn.dataset.state = 'off';
    toolbar.appendChild(modeGroup);
    toolbar.appendChild(tapeBtn);
    title.appendChild(toolbar);

    const focusOverlay = document.createElement('div');
    focusOverlay.className = 'modal-focus-overlay';

    const controls = document.createElement('div');
    controls.className = 'modal-window-controls';
    const minimizeBtn = calcCreateButton('btn-secondary minimize-btn btn-small', 'Minimize', 'fa-regular fa-window-minimize');
    const closeBtn = calcCreateButton('btn-danger close-btn btn-small', 'Close', 'fa-regular fa-xmark-large');
    closeBtn.id = 'desktopCalculatorCloseBtn';
    controls.appendChild(minimizeBtn);
    controls.appendChild(closeBtn);
    closeBtn.addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });

    const content = document.createElement('div');
    content.className = 'modal-content modal-padding dark';
    const body = document.createElement('div');
    body.className = 'modal-body';

    const pad = document.createElement('div');
    pad.className = 'form-col';
    pad.id = 'desktopCalculatorPad';
    const expression = document.createElement('div');
    expression.id = 'desktopCalculatorExpression';
    expression.className = 'form-hint';
    const readout = document.createElement('div');
    readout.id = 'desktopCalculatorDisplay';
    readout.className = 'form-control';
    readout.setAttribute('role', 'status');
    readout.setAttribute('aria-live', 'polite');
    readout.setAttribute('aria-atomic', 'true');
    pad.appendChild(expression);
    pad.appendChild(readout);

    const basesEl = document.createElement('div');
    basesEl.id = 'desktopCalculatorBases';
    basesEl.className = 'form-col';
    const baseValues = DESKTOP_CALCULATOR_BASES.map(([base, name]) => {
        const button = calcCreateButton('btn-secondary btn-toggle', name, null);
        button.dataset.calcBase = String(base);
        const nameEl = document.createElement('span');
        nameEl.textContent = name;
        const valueEl = document.createElement('span');
        button.appendChild(nameEl);
        button.appendChild(valueEl);
        basesEl.appendChild(button);
        return [base, valueEl, button];
    });
    pad.appendChild(basesEl);
    DESKTOP_CALCULATOR_MODES.forEach((mode) => pad.appendChild(calcBuildPad(mode)));

    const tape = document.createElement('div');
    tape.id = 'desktopCalculatorTape';
    tape.className = 'form-col';
    const tapeHeader = document.createElement('div');
    tapeHeader.className = 'form-row';
    const tapeTitle = document.createElement('span');
    tapeTitle.className = 'form-hint';
    tapeTitle.textContent = 'History';
    const tapeClear = calcCreateButton('btn-secondary btn-small', 'Clear history', 'fas fa-trash');
    tapeClear.id = 'desktopCalculatorTapeClear';
    tapeHeader.appendChild(tapeTitle);
    tapeHeader.appendChild(tapeClear);
    const tapeList = document.createElement('div');
    tapeList.id = 'desktopCalculatorTapeList';
    tape.appendChild(tapeHeader);
    tape.appendChild(tapeList);

    // Buttons never take focus, so Enter is only the equals key and never re-clicks a button.
    const keepFocus = (ev) => {
        if (ev.target.closest('button')) ev.preventDefault();
    };
    content.addEventListener('mousedown', keepFocus);
    toolbar.addEventListener('mousedown', keepFocus);
    content.addEventListener('click', handleDesktopCalculatorContentClick);
    toolbar.addEventListener('click', handleDesktopCalculatorToolbarClick);

    body.appendChild(pad);
    body.appendChild(tape);
    content.appendChild(body);
    modal.appendChild(title);
    modal.appendChild(focusOverlay);
    modal.appendChild(controls);
    modal.appendChild(content);
    document.body.appendChild(modal);

    desktopCalcEls = {
        modal: modal,
        display: readout,
        expression: expression,
        bases: baseValues,
        tapeList: tapeList,
        tapeBtn: tapeBtn,
        modeButtons: modeButtons,
        secondButton: modal.querySelector('[data-calc-key="second"]'),
        angleButton: modal.querySelector('[data-calc-key="angle"]'),
        bitsButton: modal.querySelector('[data-calc-key="bits"]'),
        memoryButtons: modal.querySelectorAll('[data-calc-key="mc"], [data-calc-key="mr"]'),
        programmerDigits: modal.querySelectorAll('[data-calc-pad="programmer"] [data-calc-key]')
    };
    calcSyncModeChrome();
    calcSyncMemoryButtons();
    calcSyncAngleButton();
    calcSyncBits();
    calcTapeRenderAll();
    calcRender();
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

const handleDesktopCalculatorContentClick = function (ev) {
    const button = ev.target.closest('button');
    if (!button) return;
    if (button.dataset.calcKey) {
        const key = desktopCalc.second && button.dataset.calcKey2 ? button.dataset.calcKey2 : button.dataset.calcKey;
        applyDesktopCalculatorKey(key);
    } else if (button.dataset.calcBase) {
        calcSetBase(parseInt(button.dataset.calcBase, 10));
    } else if (button.dataset.tapeId) {
        calcRecallTapeEntry(parseInt(button.dataset.tapeId, 10));
    } else if (button.id === 'desktopCalculatorTapeClear') {
        desktopCalc.tape = [];
        calcSave();
        calcTapeRenderAll();
    }
};

const handleDesktopCalculatorToolbarClick = function (ev) {
    const button = ev.target.closest('button');
    if (!button) return;
    if (button.dataset.calcModeBtn) {
        calcSetMode(button.dataset.calcModeBtn);
    } else if (button === desktopCalcEls.tapeBtn) {
        const open = !desktopCalcEls.modal.hasAttribute('data-calc-tape');
        desktopCalcEls.modal.toggleAttribute('data-calc-tape', open);
        button.dataset.state = open ? 'on' : 'off';
    }
};

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

const calcKeyFromKeyboard = function (raw) {
    const mode = desktopCalc.mode;
    let key = null;
    if (raw.length === 1 && raw >= '0' && raw <= '9') key = raw;
    else if (mode === 'programmer' && /^[a-f]$/i.test(raw)) key = raw.toUpperCase();
    else key = DESKTOP_CALCULATOR_KEYBOARD[raw]
        || (mode === 'programmer' ? DESKTOP_CALCULATOR_KEYBOARD_INT[raw] : DESKTOP_CALCULATOR_KEYBOARD_FLOAT[raw])
        || null;
    return key && DESKTOP_CALCULATOR_MODE_KEYS[mode].has(key) ? key : null;
};

const handleDesktopCalculatorKeydown = function (ev) {
    if (!ev || ev.altKey) return;
    if (desktopCalculatorForeignTextTarget(ev)) return;
    if (ev.ctrlKey || ev.metaKey) {
        const lower = String(ev.key).toLowerCase();
        if (lower === 'c' && !String(document.getSelection() || '')) {
            ev.preventDefault();
            calcCopyDisplay();
            return true;
        }
        if (lower === 'v') {
            ev.preventDefault();
            calcPasteClipboard();
            return true;
        }
        return;
    }
    const key = calcKeyFromKeyboard(ev.key);
    if (!key) return;
    ev.preventDefault();
    applyDesktopCalculatorKey(key);
    return true;
};

// ---- Numbers -------------------------------------------------------------

const calcFail = function (message) {
    throw new Error(message);
};

const calcZero = function (mode) {
    return (mode || desktopCalc.mode) === 'programmer' ? 0n : 0;
};

const calcFloatChecked = function (n) {
    if (Number.isNaN(n)) calcFail(CALC_ERR_INVALID);
    if (!Number.isFinite(n)) calcFail(CALC_ERR_OVERFLOW);
    return n;
};

const calcTrimFraction = function (text) {
    return text.indexOf('.') === -1 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
};

// 15 significant digits; exponent form only for very large or very small magnitudes.
const calcFloatText = function (n) {
    if (!Number.isFinite(n)) return null;
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e16 || abs < 1e-9) {
        const parts = n.toExponential(14).split('e');
        return calcTrimFraction(parts[0]) + 'e' + parts[1];
    }
    const rounded = Number(n.toPrecision(15));
    const decimals = Math.max(0, 14 - Math.floor(Math.log10(Math.abs(rounded))));
    return calcTrimFraction(rounded.toFixed(decimals));
};

const calcIntText = function (v, base, bits) {
    const width = bits || desktopCalc.bits;
    if (base === 10) return BigInt.asIntN(width, v).toString();
    return BigInt.asUintN(width, v).toString(base).toUpperCase();
};

const calcValueText = function (v, mode, base, bits) {
    return mode === 'programmer' ? calcIntText(v, base, bits) : calcFloatText(v);
};

const calcIntParse = function (text, base) {
    const negative = text.charAt(0) === '-';
    const digits = negative ? text.slice(1) : text;
    const v = BigInt(DESKTOP_CALCULATOR_BASE_PREFIX[base] + (digits || '0'));
    return negative ? -v : v;
};

const calcIntFits = function (raw, base, bits) {
    if (base === 10) return raw <= (1n << BigInt(bits - 1)) - 1n;
    return raw < (1n << BigInt(bits));
};

const calcGroupThousands = function (text) {
    const dot = text.indexOf('.');
    const whole = dot === -1 ? text : text.slice(0, dot);
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dot === -1 ? '' : text.slice(dot));
};

const calcGroupText = function (text, mode, base) {
    if (mode !== 'programmer') return text.indexOf('e') === -1 ? calcGroupThousands(text) : text;
    if (base === 10) return calcGroupThousands(text);
    return base === 8
        ? text.replace(/\B(?=(?:[0-7]{3})+$)/g, ' ')
        : text.replace(/\B(?=(?:[0-9A-F]{4})+$)/g, ' ');
};

const calcFactorial = function (x) {
    if (!Number.isInteger(x) || x < 0) calcFail(CALC_ERR_INVALID);
    if (x > 170) calcFail(CALC_ERR_OVERFLOW);
    let r = 1;
    for (let i = 2; i <= x; i++) r *= i;
    return r;
};

const calcToRadians = function (x, angle) {
    if (angle === 'deg') return (x % 360) * Math.PI / 180;
    if (angle === 'grad') return (x % 400) * Math.PI / 200;
    return x;
};

const calcFromRadians = function (r, angle) {
    if (angle === 'deg') return r * 180 / Math.PI;
    if (angle === 'grad') return r * 200 / Math.PI;
    return r;
};

// sin(180°) is 1.2e-16 in floating point; anything that small is a true zero here.
const calcTrigSnap = function (r) {
    return Math.abs(r) < 1e-15 ? 0 : r;
};

const DESKTOP_CALCULATOR_FLOAT_FNS = {
    neg: (x) => -x,
    pct: (x) => x / 100,
    sqr: (x) => x * x,
    cube: (x) => x * x * x,
    sqrt: (x) => (x < 0 ? calcFail(CALC_ERR_INVALID) : Math.sqrt(x)),
    cbrt: (x) => Math.cbrt(x),
    recip: (x) => (x === 0 ? calcFail(CALC_ERR_DIV0) : 1 / x),
    abs: (x) => Math.abs(x),
    fact: calcFactorial,
    pow10: (x) => Math.pow(10, x),
    pow2: (x) => Math.pow(2, x),
    exp: (x) => Math.exp(x),
    log: (x) => (x <= 0 ? calcFail(CALC_ERR_INVALID) : Math.log10(x)),
    log2: (x) => (x <= 0 ? calcFail(CALC_ERR_INVALID) : Math.log2(x)),
    ln: (x) => (x <= 0 ? calcFail(CALC_ERR_INVALID) : Math.log(x)),
    sin: (x, angle) => calcTrigSnap(Math.sin(calcToRadians(x, angle))),
    cos: (x, angle) => calcTrigSnap(Math.cos(calcToRadians(x, angle))),
    tan: (x, angle) => {
        const r = calcToRadians(x, angle);
        if (Math.abs(Math.cos(r)) < 1e-15) calcFail(CALC_ERR_INVALID);
        return calcTrigSnap(Math.tan(r));
    },
    asin: (x, angle) => (x < -1 || x > 1 ? calcFail(CALC_ERR_INVALID) : calcFromRadians(Math.asin(x), angle)),
    acos: (x, angle) => (x < -1 || x > 1 ? calcFail(CALC_ERR_INVALID) : calcFromRadians(Math.acos(x), angle)),
    atan: (x, angle) => calcFromRadians(Math.atan(x), angle),
    sinh: (x) => Math.sinh(x),
    cosh: (x) => Math.cosh(x),
    tanh: (x) => Math.tanh(x),
    asinh: (x) => Math.asinh(x),
    acosh: (x) => (x < 1 ? calcFail(CALC_ERR_INVALID) : Math.acosh(x)),
    atanh: (x) => (x <= -1 || x >= 1 ? calcFail(CALC_ERR_INVALID) : Math.atanh(x)),
    floor: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    round: (x) => Math.round(x)
};

const calcFloatRoot = function (x, y) {
    if (y === 0) calcFail(CALC_ERR_INVALID);
    if (x < 0) {
        if (Number.isInteger(y) && Math.abs(y % 2) === 1) return -Math.pow(-x, 1 / y);
        calcFail(CALC_ERR_INVALID);
    }
    return Math.pow(x, 1 / y);
};

const calcFloatBinary = function (op, a, b) {
    switch (op) {
        case '+': return calcFloatChecked(a + b);
        case '-': return calcFloatChecked(a - b);
        case '*': return calcFloatChecked(a * b);
        case '/': return b === 0 ? calcFail(CALC_ERR_DIV0) : calcFloatChecked(a / b);
        case 'mod': return b === 0 ? calcFail(CALC_ERR_DIV0) : calcFloatChecked(a % b);
        case 'pow': return calcFloatChecked(Math.pow(a, b));
        case 'yroot': return calcFloatChecked(calcFloatRoot(a, b));
        default: return calcFail(CALC_ERR_INVALID);
    }
};

const calcIntBinary = function (op, a, b, bits) {
    const width = BigInt(bits);
    let r;
    switch (op) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': if (b === 0n) calcFail(CALC_ERR_DIV0); r = a / b; break;
        case 'mod': if (b === 0n) calcFail(CALC_ERR_DIV0); r = a % b; break;
        case 'and': r = a & b; break;
        case 'or': r = a | b; break;
        case 'xor': r = a ^ b; break;
        case 'nand': r = ~(a & b); break;
        case 'nor': r = ~(a | b); break;
        case 'lsh':
            if (b < 0n) calcFail(CALC_ERR_INVALID);
            r = b >= width ? 0n : a << b;
            break;
        case 'rsh':
            if (b < 0n) calcFail(CALC_ERR_INVALID);
            r = b >= width ? (a < 0n ? -1n : 0n) : a >> b;
            break;
        default: calcFail(CALC_ERR_INVALID);
    }
    return BigInt.asIntN(bits, r);
};

const calcDomain = function (mode, angle, bits) {
    if (mode === 'programmer') {
        return {
            prec: DESKTOP_CALCULATOR_INT_PREC,
            binary: (op, a, b) => calcIntBinary(op, a, b, bits),
            unary: (name, v) => {
                if (name === 'neg') return BigInt.asIntN(bits, -v);
                if (name === 'not') return BigInt.asIntN(bits, ~v);
                return calcFail('Not available in programmer mode');
            }
        };
    }
    return {
        prec: mode === 'standard' ? DESKTOP_CALCULATOR_STANDARD_PREC : DESKTOP_CALCULATOR_FLOAT_PREC,
        binary: calcFloatBinary,
        unary: (name, v) => {
            const fn = Object.prototype.hasOwnProperty.call(DESKTOP_CALCULATOR_FLOAT_FNS, name) ? DESKTOP_CALCULATOR_FLOAT_FNS[name] : null;
            if (!fn) calcFail(CALC_ERR_INVALID);
            return calcFloatChecked(fn(v, angle));
        }
    };
};

const calcDomainNow = function () {
    return calcDomain(desktopCalc.mode, desktopCalc.angle, desktopCalc.bits);
};

// ---- Tokens --------------------------------------------------------------
// { t: 'num', v, label? } { t: 'op', v } { t: 'pre', v } (neg, not, function) { t: 'post', v } (fact, pct) { t: '(' } { t: ')' }

const calcEvaluateTokens = function (tokens, domain) {
    const values = [];
    const ops = [];
    const precOf = (tok) => {
        const p = domain.prec[tok.v];
        return p === undefined ? DESKTOP_CALCULATOR_FN_PREC : p;
    };
    const applyTop = () => {
        const op = ops.pop();
        if (op.t === 'op') {
            if (values.length < 2) calcFail(CALC_ERR_INVALID);
            const right = values.pop();
            values.push(domain.binary(op.v, values.pop(), right));
            return;
        }
        if (!values.length) calcFail(CALC_ERR_INVALID);
        values.push(domain.unary(op.v, values.pop()));
    };
    tokens.forEach((tok) => {
        if (tok.t === 'num') {
            values.push(tok.v);
        } else if (tok.t === 'pre' || tok.t === '(') {
            ops.push(tok);
        } else if (tok.t === ')') {
            while (ops.length && ops[ops.length - 1].t !== '(') applyTop();
            if (!ops.length) calcFail(CALC_ERR_INVALID);
            ops.pop();
            const top = ops[ops.length - 1];
            if (top && top.t === 'pre' && domain.prec[top.v] === undefined) applyTop();
        } else if (tok.t === 'post') {
            if (!values.length) calcFail(CALC_ERR_INVALID);
            values.push(domain.unary(tok.v, values.pop()));
        } else {
            const p = domain.prec[tok.v];
            if (p === undefined) calcFail(CALC_ERR_INVALID);
            const rightAssoc = DESKTOP_CALCULATOR_RIGHT_ASSOC.has(tok.v);
            while (ops.length) {
                const top = ops[ops.length - 1];
                if (top.t === '(') break;
                const tp = precOf(top);
                if (tp > p || (tp === p && !rightAssoc)) applyTop();
                else break;
            }
            ops.push(tok);
        }
    });
    while (ops.length) {
        if (ops[ops.length - 1].t === '(') ops.pop();
        else applyTop();
    }
    if (values.length !== 1) calcFail(CALC_ERR_INVALID);
    return values[0];
};

const calcTokensText = function (tokens, mode, base, bits) {
    let out = '';
    let prev = null;
    tokens.forEach((tok) => {
        let piece;
        if (tok.t === 'num') piece = tok.label || calcValueText(tok.v, mode, base, bits);
        else if (tok.t === 'op') piece = DESKTOP_CALCULATOR_OP_TEXT[tok.v];
        else if (tok.t === 'pre') piece = tok.v === 'neg' ? '\u2212' : (tok.v === 'not' ? 'NOT' : tok.v);
        else if (tok.t === 'post') piece = tok.v === 'pct' ? '%' : '!';
        else piece = tok.t;
        const tight = prev && (prev.t === '(' || (prev.t === 'pre' && prev.v !== 'not') || tok.t === ')' || tok.t === 'post');
        out += (out && !tight ? ' ' : '') + piece;
        prev = tok;
    });
    return out;
};

const calcOpenParenCount = function (tokens) {
    let depth = 0;
    tokens.forEach((tok) => {
        if (tok.t === '(') depth++;
        else if (tok.t === ')') depth--;
    });
    return depth;
};

const calcMatchingParenIndex = function (tokens) {
    let depth = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].t === ')') depth++;
        else if (tokens[i].t === '(' && --depth === 0) return i;
    }
    return 0;
};

// Text expressions (MCP set_calculator evaluate, Ctrl+V). Never eval.
const calcTokenize = function (source, mode, bits) {
    const programmer = mode === 'programmer';
    const tokens = [];
    const endsValue = () => {
        const last = tokens[tokens.length - 1];
        return !!last && (last.t === 'num' || last.t === ')' || last.t === 'post');
    };
    // 2pi, 3(4), 2 sqrt(9): implicit multiplication
    const pushValueStart = (tok) => {
        if (endsValue()) tokens.push({ t: 'op', v: '*' });
        tokens.push(tok);
    };
    const pushNumber = (v) => pushValueStart({ t: 'num', v: v });
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        const rest = source.slice(i);
        let m = /^0(?:x[0-9a-f]+|b[01]+|o[0-7]+)/i.exec(rest);
        if (m) {
            const big = BigInt(m[0].slice(0, 2).toLowerCase() + m[0].slice(2));
            pushNumber(programmer ? BigInt.asIntN(bits, big) : Number(big));
            i += m[0].length;
            continue;
        }
        m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
        if (m) {
            if (programmer) {
                if (/[.e]/i.test(m[0])) calcFail('Programmer mode takes whole numbers');
                pushNumber(BigInt.asIntN(bits, BigInt(m[0])));
            } else {
                pushNumber(parseFloat(m[0]));
            }
            i += m[0].length;
            continue;
        }
        m = /^[a-z\u03c0_][a-z0-9_]*/i.exec(rest);
        if (m) {
            const word = m[0].toLowerCase();
            i += m[0].length;
            if (!programmer && (word === 'pi' || word === '\u03c0')) pushNumber(Math.PI);
            else if (!programmer && word === 'e') pushNumber(Math.E);
            else if (Object.prototype.hasOwnProperty.call(DESKTOP_CALCULATOR_WORD_OPS, word)) tokens.push({ t: 'op', v: DESKTOP_CALCULATOR_WORD_OPS[word] });
            else if (word === 'not') pushValueStart({ t: 'pre', v: 'not' });
            else if (!programmer && word !== 'neg' && word !== 'pct' && Object.prototype.hasOwnProperty.call(DESKTOP_CALCULATOR_FLOAT_FNS, word)) pushValueStart({ t: 'pre', v: word });
            else if (word === 'log10') pushValueStart({ t: 'pre', v: 'log' });
            else calcFail('Unknown name: ' + m[0]);
            continue;
        }
        const pair = source.substr(i, 2);
        if (pair === '<<' || pair === '>>' || pair === '**') {
            tokens.push({ t: 'op', v: pair === '<<' ? 'lsh' : (pair === '>>' ? 'rsh' : 'pow') });
            i += 2;
            continue;
        }
        i++;
        if (ch === '+') {
            if (endsValue()) tokens.push({ t: 'op', v: '+' });
        } else if (ch === '-' || ch === '\u2212') {
            tokens.push(endsValue() ? { t: 'op', v: '-' } : { t: 'pre', v: 'neg' });
        } else if (ch === '*' || ch === '\u00d7') tokens.push({ t: 'op', v: '*' });
        else if (ch === '/' || ch === '\u00f7') tokens.push({ t: 'op', v: '/' });
        else if (ch === '^') tokens.push({ t: 'op', v: programmer ? 'xor' : 'pow' });
        else if (ch === '&') tokens.push({ t: 'op', v: 'and' });
        else if (ch === '|') tokens.push({ t: 'op', v: 'or' });
        else if (ch === '~') pushValueStart({ t: 'pre', v: 'not' });
        else if (ch === '%') tokens.push(programmer ? { t: 'op', v: 'mod' } : { t: 'post', v: 'pct' });
        else if (ch === '!') tokens.push({ t: 'post', v: 'fact' });
        else if (ch === '\u221a') pushValueStart({ t: 'pre', v: 'sqrt' });
        else if (ch === '\u221b') pushValueStart({ t: 'pre', v: 'cbrt' });
        else if (ch === '(') pushValueStart({ t: '(' });
        else if (ch === ')') tokens.push({ t: ')' });
        else calcFail('Unexpected character: ' + ch);
        if (tokens.length > DESKTOP_CALCULATOR_TOKENS_MAX) calcFail('Expression is too long');
    }
    return tokens;
};

const calcEvaluateText = function (text, mode, angle, bits, base) {
    const source = String(text == null ? '' : text).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
    if (source.length > DESKTOP_CALCULATOR_EXPR_MAX) calcFail('Expression is too long');
    const tokens = calcTokenize(source, mode, bits);
    if (!tokens.length) calcFail(CALC_ERR_INVALID);
    const value = calcEvaluateTokens(tokens, calcDomain(mode, angle, bits));
    return { tokens: tokens, value: value, expr: calcTokensText(tokens, mode, base, bits) };
};

// ---- Keypad --------------------------------------------------------------

const applyDesktopCalculatorKey = function (key) {
    calcEnsureLoaded();
    try {
        calcDispatchKey(key);
    } catch (err) {
        calcShowError((err && err.message) || CALC_ERR_INVALID);
    }
    calcRender();
};

const calcIsDigitKey = function (key) {
    return /^[0-9A-F]$/.test(key);
};

const calcDispatchKey = function (key) {
    if (desktopCalc.error) {
        if (key === 'clear' || key === 'ce' || key === 'backspace') {
            calcClearAll();
            return;
        }
        if (!calcIsDigitKey(key) && key !== '.') return;
        calcClearAll();
    }
    if (calcIsDigitKey(key)) {
        calcInputDigit(key);
        return;
    }
    switch (key) {
        case '.': calcInputDecimal(); return;
        case '=': calcEquals(); return;
        case 'clear': calcClearAll(); return;
        case 'ce': calcClearEntry(); return;
        case 'backspace': calcBackspace(); return;
        case 'sign': calcToggleSign(); return;
        case 'percent': calcPercent(); return;
        case '(': calcOpenParen(); return;
        case ')': calcCloseParen(); return;
        case 'pi': calcSetEntryValue(Math.PI, '\u03c0'); return;
        case 'e': calcSetEntryValue(Math.E, 'e'); return;
        case 'mc': case 'mr': case 'mplus': case 'mminus': case 'ms': calcMemoryKey(key); return;
        case 'second': calcToggleSecond(); return;
        case 'angle': calcCycleAngle(); return;
        case 'bits': calcCycleBits(); return;
        default:
            if (Object.prototype.hasOwnProperty.call(DESKTOP_CALCULATOR_OP_TEXT, key)) calcApplyOperator(key);
            else if (Object.prototype.hasOwnProperty.call(DESKTOP_CALCULATOR_UNARY_LABELS, key)) calcApplyUnary(key);
    }
};

const calcSetEntryValue = function (value, label) {
    const c = desktopCalc;
    c.value = value;
    c.entry = calcValueText(value, c.mode, c.base);
    c.label = label || null;
    c.typing = false;
    c.live = true;
    c.shownExpr = '';
};

const calcEntryToken = function () {
    const tok = { t: 'num', v: desktopCalc.value };
    if (desktopCalc.label) tok.label = desktopCalc.label;
    return tok;
};

const calcShowError = function (message) {
    calcClearAll();
    desktopCalc.error = message;
};

const calcClearAll = function () {
    const c = desktopCalc;
    c.tokens = [];
    c.value = calcZero();
    c.entry = '0';
    c.label = null;
    c.typing = false;
    c.live = true;
    c.repeat = null;
    c.error = null;
    c.shownExpr = '';
};

const calcClearEntry = function () {
    const c = desktopCalc;
    c.value = calcZero();
    c.entry = '0';
    c.label = null;
    c.typing = false;
    c.live = true;
    if (!c.tokens.length) c.shownExpr = '';
};

const calcStartTyping = function () {
    const c = desktopCalc;
    c.typing = true;
    c.live = true;
    c.label = null;
    c.shownExpr = '';
};

const calcInputDigit = function (digit) {
    const c = desktopCalc;
    if (c.mode === 'programmer') {
        if (parseInt(digit, 16) >= c.base) return;
        const next = c.typing && c.entry !== '0' ? c.entry + digit : digit;
        const raw = calcIntParse(next, c.base);
        if (!calcIntFits(raw, c.base, c.bits)) return;
        c.entry = next;
        c.value = BigInt.asIntN(c.bits, raw);
    } else {
        if (parseInt(digit, 16) > 9) return;
        if (!c.typing || c.entry === '0') c.entry = digit;
        else if (c.entry === '-0') c.entry = '-' + digit;
        else if (c.entry.replace(/[-.]/g, '').length >= DESKTOP_CALCULATOR_MAX_DIGITS) return;
        else c.entry += digit;
        c.value = parseFloat(c.entry);
    }
    calcStartTyping();
};

const calcInputDecimal = function () {
    const c = desktopCalc;
    if (c.mode === 'programmer') return;
    if (!c.typing) {
        c.entry = '0.';
        c.value = 0;
    } else if (c.entry.indexOf('.') === -1) {
        c.entry += '.';
    }
    calcStartTyping();
};

const calcBackspace = function () {
    const c = desktopCalc;
    if (!c.typing) {
        c.shownExpr = '';
        return;
    }
    let next = c.entry.slice(0, -1);
    if (next === '' || next === '-' || next === '-0') next = '0';
    c.entry = next;
    c.value = c.mode === 'programmer' ? BigInt.asIntN(c.bits, calcIntParse(next, c.base)) : parseFloat(next);
};

const calcApplyOperator = function (op) {
    const c = desktopCalc;
    if (calcDomainNow().prec[op] === undefined) return;
    const last = c.tokens[c.tokens.length - 1];
    if (!c.live) {
        if (last && last.t === 'op') {
            last.v = op;
            return;
        }
        if (last && last.t === '(') return;
    } else {
        c.tokens.push(calcEntryToken());
    }
    if (c.mode === 'standard') {
        c.value = calcEvaluateTokens(c.tokens, calcDomainNow());
        c.entry = calcValueText(c.value, c.mode, c.base);
    }
    c.tokens.push({ t: 'op', v: op });
    c.live = false;
    c.typing = false;
    c.label = null;
    c.repeat = null;
    c.shownExpr = '';
};

const calcApplyUnary = function (name) {
    const c = desktopCalc;
    const last = c.tokens[c.tokens.length - 1];
    let inner;
    if (!c.live && last && last.t === ')') {
        const start = calcMatchingParenIndex(c.tokens);
        inner = calcTokensText(c.tokens.slice(start + 1, -1), c.mode, c.base);
        c.tokens.length = start;
    } else {
        inner = c.live && c.label ? c.label : calcValueText(c.value, c.mode, c.base);
    }
    const result = calcDomainNow().unary(name, c.value);
    calcSetEntryValue(result, DESKTOP_CALCULATOR_UNARY_LABELS[name] + '(' + inner + ')');
};

const calcToggleSign = function () {
    const c = desktopCalc;
    if (c.typing && c.mode !== 'programmer') {
        c.entry = c.entry.charAt(0) === '-' ? c.entry.slice(1) : '-' + c.entry;
        c.value = parseFloat(c.entry);
        return;
    }
    calcApplyUnary('neg');
};

// Windows rule: a + b% is a + a*b/100; anywhere else b% is b/100.
const calcPercent = function () {
    const c = desktopCalc;
    const last = c.tokens[c.tokens.length - 1];
    let result = c.value / 100;
    if (last && last.t === 'op' && (last.v === '+' || last.v === '-') && calcOpenParenCount(c.tokens) === 0) {
        result = calcEvaluateTokens(c.tokens.slice(0, -1), calcDomainNow()) * c.value / 100;
    }
    calcSetEntryValue(calcFloatChecked(result), null);
};

const calcOpenParen = function () {
    const c = desktopCalc;
    if (c.mode === 'standard') return;
    const last = c.tokens[c.tokens.length - 1];
    if (c.live && (c.typing || c.label || c.tokens.length)) {
        c.tokens.push(calcEntryToken());
        c.tokens.push({ t: 'op', v: '*' });
    } else if (!c.live && last && last.t === ')') {
        c.tokens.push({ t: 'op', v: '*' });
    }
    c.tokens.push({ t: '(' });
    c.live = false;
    c.typing = false;
    c.label = null;
    c.shownExpr = '';
};

const calcCloseParen = function () {
    const c = desktopCalc;
    if (c.mode === 'standard' || calcOpenParenCount(c.tokens) < 1) return;
    const last = c.tokens[c.tokens.length - 1];
    if (c.live) c.tokens.push(calcEntryToken());
    else if (last.t === 'op' || last.t === '(') c.tokens.push({ t: 'num', v: c.value });
    c.tokens.push({ t: ')' });
    c.value = calcEvaluateTokens(c.tokens.slice(calcMatchingParenIndex(c.tokens)), calcDomainNow());
    c.entry = calcValueText(c.value, c.mode, c.base);
    c.live = false;
    c.typing = false;
    c.label = null;
    c.shownExpr = '';
};

const calcEquals = function () {
    const c = desktopCalc;
    let tokens = c.tokens.slice();
    if (!tokens.length) {
        if (c.repeat) tokens = [calcEntryToken(), { t: 'op', v: c.repeat.op }, c.repeat.operand];
        else if (c.live && c.label) tokens = [calcEntryToken()];
        else return;
    } else {
        const last = tokens[tokens.length - 1];
        if (c.live) tokens.push(calcEntryToken());
        else if (last.t === 'op' || last.t === '(') tokens.push({ t: 'num', v: c.value });
        for (let open = calcOpenParenCount(tokens); open > 0; open--) tokens.push({ t: ')' });
    }
    const result = calcEvaluateTokens(tokens, calcDomainNow());
    const tail = tokens[tokens.length - 1];
    const beforeTail = tokens[tokens.length - 2];
    const repeat = tail.t === 'num' && beforeTail && beforeTail.t === 'op'
        ? { op: beforeTail.v, operand: { t: 'num', v: tail.v } }
        : null;
    const expr = calcTokensText(tokens, c.mode, c.base);
    calcTapePush({ kind: 'calc', expr: expr, value: result, source: 'user' });
    c.tokens = [];
    calcSetEntryValue(result, null);
    c.repeat = repeat;
    c.shownExpr = expr + ' =';
};

const calcFromNumber = function (n) {
    if (desktopCalc.mode !== 'programmer') return n;
    return BigInt.asIntN(desktopCalc.bits, BigInt(Math.trunc(n)));
};

const calcMemoryKey = function (key) {
    const c = desktopCalc;
    if (key === 'mr') {
        if (c.memory !== null) calcSetEntryValue(calcFromNumber(c.memory), null);
        return;
    }
    const current = Number(c.value);
    if (key === 'mc') c.memory = null;
    else if (key === 'ms') c.memory = current;
    else if (key === 'mplus') c.memory = calcFloatChecked((c.memory || 0) + current);
    else c.memory = calcFloatChecked((c.memory || 0) - current);
    c.typing = false;
    calcSyncMemoryButtons();
    calcSave();
};

const calcToggleSecond = function () {
    desktopCalc.second = !desktopCalc.second;
    if (!desktopCalcEls) return;
    desktopCalcEls.modal.toggleAttribute('data-calc-second', desktopCalc.second);
    desktopCalcEls.secondButton.dataset.state = desktopCalc.second ? 'on' : 'off';
};

const calcCycleAngle = function () {
    const angles = DESKTOP_CALCULATOR_ANGLES;
    desktopCalc.angle = angles[(angles.indexOf(desktopCalc.angle) + 1) % angles.length];
    calcSyncAngleButton();
    calcSave();
};

const calcCycleBits = function () {
    const c = desktopCalc;
    const words = DESKTOP_CALCULATOR_WORDS;
    c.bits = words[(words.indexOf(c.bits) + 1) % words.length];
    c.value = BigInt.asIntN(c.bits, c.value);
    c.entry = calcValueText(c.value, c.mode, c.base);
    c.typing = false;
    calcSyncBits();
    calcSave();
};

const calcSetBase = function (base) {
    const c = desktopCalc;
    if (c.mode !== 'programmer' || c.base === base) return;
    c.base = base;
    c.entry = calcValueText(c.value, c.mode, c.base);
    c.typing = false;
    calcSyncBits();
    calcSave();
    calcRender();
};

const calcSetMode = function (mode) {
    const c = desktopCalc;
    if (c.mode === mode || DESKTOP_CALCULATOR_MODES.indexOf(mode) === -1) return;
    c.mode = mode;
    if (c.second) calcToggleSecond();
    calcClearAll();
    calcSyncModeChrome();
    calcSave();
    calcRender();
    calcRefitHeight();
};

// ---- Chrome sync (only on the change that needs it) ----------------------

const calcSyncModeChrome = function () {
    if (!desktopCalcEls) return;
    desktopCalcEls.modal.dataset.calcMode = desktopCalc.mode;
    desktopCalcEls.modeButtons.forEach((button) => {
        button.dataset.state = button.dataset.calcModeBtn === desktopCalc.mode ? 'on' : 'off';
    });
};

const calcSyncMemoryButtons = function () {
    if (!desktopCalcEls) return;
    const empty = desktopCalc.memory === null;
    desktopCalcEls.memoryButtons.forEach((button) => {
        button.disabled = empty;
    });
};

const calcSyncAngleButton = function () {
    if (desktopCalcEls) desktopCalcEls.angleButton.textContent = desktopCalc.angle.toUpperCase();
};

const calcSyncBits = function () {
    if (!desktopCalcEls) return;
    const base = desktopCalc.base;
    desktopCalcEls.bitsButton.textContent = DESKTOP_CALCULATOR_WORD_NAMES[desktopCalc.bits];
    desktopCalcEls.bases.forEach((row) => {
        row[2].dataset.state = row[0] === base ? 'on' : 'off';
    });
    desktopCalcEls.programmerDigits.forEach((button) => {
        if (calcIsDigitKey(button.dataset.calcKey)) button.disabled = parseInt(button.dataset.calcKey, 16) >= base;
    });
};

// Keypads differ in row count, so the window minimum follows the visible one.
const calcRefitHeight = function () {
    const modal = desktopCalcEls && desktopCalcEls.modal;
    if (!modal) return;
    const tapeOpen = modal.hasAttribute('data-calc-tape');
    if (tapeOpen) modal.removeAttribute('data-calc-tape');
    desktopAppApplyContentHeight(modal);
    if (tapeOpen) modal.setAttribute('data-calc-tape', '');
    const min = parseInt(modal.dataset.windowMinHeight, 10);
    // isModalMaximized: public/scripts/comp/modalUtils.js
    if (min > 0 && !isModalMaximized(modal) && modal.getBoundingClientRect().height < min) {
        modal.style.height = min + 'px';
    }
};

const calcPendingText = function () {
    const c = desktopCalc;
    const text = calcTokensText(c.tokens, c.mode, c.base);
    return c.live && c.label ? (text ? text + ' ' : '') + c.label : text;
};

const calcRender = function () {
    if (!desktopCalcEls) return;
    const c = desktopCalc;
    desktopCalcEls.display.textContent = c.error || calcGroupText(c.entry, c.mode, c.base);
    desktopCalcEls.expression.textContent = (c.error ? '' : (c.shownExpr || calcPendingText())) || '\u00a0';
    if (c.mode !== 'programmer') return;
    desktopCalcEls.bases.forEach((row) => {
        row[1].textContent = calcGroupText(calcIntText(c.value, row[0]), 'programmer', row[0]);
    });
};

// ---- Clipboard -----------------------------------------------------------

const calcCopyDisplay = function () {
    if (desktopCalc.error) return;
    navigator.clipboard.writeText(desktopCalc.entry).catch(() => { /* clipboard permission denied */ });
};

const calcPasteClipboard = function () {
    navigator.clipboard.readText().then((text) => {
        const c = desktopCalc;
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        try {
            if (c.mode === 'programmer' && c.base !== 10 && /^[0-9a-f]+$/i.test(trimmed)) {
                const raw = calcIntParse(trimmed.toUpperCase(), c.base);
                if (!calcIntFits(raw, c.base, c.bits) || trimmed.split('').some((d) => parseInt(d, 16) >= c.base)) calcFail(CALC_ERR_INVALID);
                calcSetEntryValue(BigInt.asIntN(c.bits, raw), null);
            } else {
                const evaluated = calcEvaluateText(trimmed, c.mode, c.angle, c.bits, c.base);
                if (evaluated.tokens.length === 1) {
                    calcSetEntryValue(evaluated.value, null);
                } else {
                    calcTapePush({ kind: 'calc', expr: evaluated.expr, value: evaluated.value, source: 'user' });
                    c.tokens = [];
                    calcSetEntryValue(evaluated.value, null);
                    c.shownExpr = evaluated.expr + ' =';
                }
            }
        } catch (err) {
            calcShowError((err && err.message) || CALC_ERR_INVALID);
        }
        calcRender();
    }).catch(() => { /* clipboard permission denied */ });
};

// ---- History tape --------------------------------------------------------
// Entry: { id, at, kind: calc|note, mode, source: user|mcp, expr?, result?, value?, note?, angle?, base?, bits? }
// value is a Number, or a decimal string for programmer (BigInt) results.

const calcTapePush = function (spec) {
    const c = desktopCalc;
    const mode = spec.mode || c.mode;
    const entry = {
        id: c.nextId++,
        at: new Date().toISOString(),
        kind: spec.kind,
        mode: mode,
        source: spec.source || 'user'
    };
    if (spec.expr) entry.expr = spec.expr;
    if (spec.note) entry.note = spec.note;
    if (mode === 'scientific') entry.angle = spec.angle || c.angle;
    if (spec.value !== undefined && spec.value !== null) {
        if (mode === 'programmer') {
            const base = spec.base || c.base;
            const bits = spec.bits || c.bits;
            entry.base = base;
            entry.bits = bits;
            entry.value = BigInt.asIntN(bits, spec.value).toString();
            entry.result = DESKTOP_CALCULATOR_BASE_PREFIX[base] + calcIntText(spec.value, base, bits);
        } else {
            entry.value = spec.value;
            entry.result = calcFloatText(spec.value);
        }
    }
    c.tape.unshift(entry);
    if (c.tape.length > DESKTOP_CALCULATOR_TAPE_MAX) c.tape.length = DESKTOP_CALCULATOR_TAPE_MAX;
    calcSave();
    if (desktopCalcEls) {
        const list = desktopCalcEls.tapeList;
        list.insertBefore(calcTapeElement(entry), list.firstChild);
        while (list.children.length > DESKTOP_CALCULATOR_TAPE_MAX) list.lastChild.remove();
    }
    return entry;
};

const calcTapeElement = function (entry) {
    const button = calcCreateButton('btn-secondary', '', null);
    button.dataset.tapeId = String(entry.id);
    button.title = new Date(entry.at).toLocaleString() + (entry.source === 'mcp' ? ' \u00b7 added remotely' : '');
    const hint = document.createElement('span');
    hint.className = 'form-hint';
    if (entry.kind === 'note') hint.textContent = entry.note || '';
    else hint.textContent = (entry.note ? entry.note + ' \u00b7 ' : '') + (entry.expr || '') + ' =';
    button.appendChild(hint);
    if (entry.result !== undefined) {
        const result = document.createElement('span');
        result.textContent = entry.mode === 'programmer' ? entry.result : calcGroupText(entry.result, entry.mode, 10);
        button.appendChild(result);
    }
    return button;
};

const calcTapeRenderAll = function () {
    if (!desktopCalcEls) return;
    const fragment = document.createDocumentFragment();
    desktopCalc.tape.forEach((entry) => fragment.appendChild(calcTapeElement(entry)));
    desktopCalcEls.tapeList.replaceChildren(fragment);
};

const calcRecallTapeEntry = function (id) {
    const c = desktopCalc;
    const entry = c.tape.find((row) => row.id === id);
    if (!entry || entry.value === undefined) return;
    if (c.mode === 'programmer') {
        const big = entry.mode === 'programmer' ? BigInt(entry.value) : BigInt(Math.trunc(Number(entry.value)));
        calcSetEntryValue(BigInt.asIntN(c.bits, big), null);
    } else {
        calcSetEntryValue(Number(entry.value), null);
    }
    c.error = null;
    calcRender();
};

// ---- Storage -------------------------------------------------------------

const calcEnsureLoaded = function () {
    const c = desktopCalc;
    if (c.loaded) return;
    c.loaded = true;
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(DESKTOP_CALCULATOR_STORAGE_KEY) || 'null');
    } catch (_err) {
        saved = null;
    }
    if (saved && typeof saved === 'object') {
        if (DESKTOP_CALCULATOR_MODES.indexOf(saved.mode) !== -1) c.mode = saved.mode;
        if (DESKTOP_CALCULATOR_ANGLES.indexOf(saved.angle) !== -1) c.angle = saved.angle;
        if (saved.base === 16 || saved.base === 10 || saved.base === 8 || saved.base === 2) c.base = saved.base;
        if (DESKTOP_CALCULATOR_WORDS.indexOf(saved.bits) !== -1) c.bits = saved.bits;
        if (typeof saved.memory === 'number' && Number.isFinite(saved.memory)) c.memory = saved.memory;
        if (Array.isArray(saved.tape)) {
            c.tape = saved.tape.filter((row) => row && typeof row.id === 'number').slice(0, DESKTOP_CALCULATOR_TAPE_MAX);
            c.nextId = c.tape.reduce((max, row) => Math.max(max, row.id), 0) + 1;
        }
    }
    c.value = calcZero();
};

const calcSave = function () {
    const c = desktopCalc;
    try {
        localStorage.setItem(DESKTOP_CALCULATOR_STORAGE_KEY, JSON.stringify({
            v: 1, mode: c.mode, angle: c.angle, base: c.base, bits: c.bits, memory: c.memory, tape: c.tape
        }));
    } catch (_err) { /* storage full or disabled: the tape stays in memory for this tab */ }
};

// ---- MCP (public/scripts/comp/agentClientBridge.js) ------------------------

const calcBasesOf = function (v, bits) {
    return {
        hex: calcIntText(v, 16, bits),
        dec: calcIntText(v, 10, bits),
        oct: calcIntText(v, 8, bits),
        bin: calcIntText(v, 2, bits)
    };
};

// get_calculator. Works with the window closed; the tape is in this browser's localStorage.
function readDesktopCalculatorForAgent(data) {
    calcEnsureLoaded();
    const c = desktopCalc;
    const requested = parseInt(data && data.tapeLimit, 10);
    const limit = Number.isFinite(requested) ? Math.max(0, Math.min(DESKTOP_CALCULATOR_TAPE_MAX, requested)) : 50;
    const modal = document.getElementById(DESKTOP_CALCULATOR_MODAL_ID);
    const state = {
        ok: true,
        open: !!modal && !modal.classList.contains('hidden'),
        mode: c.mode,
        angle: c.angle,
        display: c.error || c.entry,
        value: c.error ? null : (typeof c.value === 'bigint' ? c.value.toString() : c.value),
        expression: c.error ? '' : (c.shownExpr || calcPendingText()),
        error: c.error,
        memory: c.memory,
        tapeCount: c.tape.length,
        tape: c.tape.slice(0, limit)
    };
    if (c.mode === 'programmer') {
        state.base = c.base;
        state.wordSize = DESKTOP_CALCULATOR_WORD_NAMES[c.bits];
        state.bases = calcBasesOf(c.value, c.bits);
    }
    return state;
}

const calcAgentNumber = function (value, field) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (!Number.isFinite(n)) calcFail(field + ' must be a finite number');
    return n;
};

// set_calculator: evaluate | note | delete_entries | clear_tape | set_memory | clear_memory
function applyDesktopCalculatorAgentAction(data) {
    calcEnsureLoaded();
    const c = desktopCalc;
    const input = data || {};
    const action = input.action;
    let reply;
    try {
        if (action === 'evaluate') {
            const mode = DESKTOP_CALCULATOR_MODES.indexOf(input.mode) !== -1 ? input.mode : 'scientific';
            const angle = DESKTOP_CALCULATOR_ANGLES.indexOf(input.angle) !== -1 ? input.angle : c.angle;
            const bits = DESKTOP_CALCULATOR_WORDS.indexOf(Number(input.wordBits)) !== -1 ? Number(input.wordBits) : 64;
            const evaluated = calcEvaluateText(input.expression, mode, angle, bits, 10);
            const entry = calcTapePush({
                kind: 'calc', mode: mode, angle: angle, bits: bits, base: 10,
                expr: evaluated.expr, value: evaluated.value, note: input.note, source: 'mcp'
            });
            reply = { ok: true, action: action, mode: mode, expression: evaluated.expr, result: entry.result, value: entry.value, entry: entry };
            if (mode === 'scientific') reply.angle = angle;
            if (mode === 'programmer') reply.bases = calcBasesOf(evaluated.value, bits);
            if (input.display) {
                calcClearAll();
                calcRecallTapeEntry(entry.id);
                c.shownExpr = evaluated.expr + ' =';
            }
        } else if (action === 'note') {
            const value = input.value === undefined || input.value === null ? undefined : calcAgentNumber(input.value, 'value');
            const entry = calcTapePush({
                kind: 'note', mode: c.mode === 'programmer' ? 'standard' : c.mode,
                note: input.note, value: value, source: 'mcp'
            });
            reply = { ok: true, action: action, entry: entry };
        } else if (action === 'delete_entries') {
            const ids = new Set((input.ids || []).map(Number));
            const before = c.tape.length;
            const found = new Set();
            c.tape = c.tape.filter((row) => {
                if (!ids.has(row.id)) return true;
                found.add(row.id);
                return false;
            });
            calcSave();
            calcTapeRenderAll();
            reply = { ok: true, action: action, removed: before - c.tape.length, missing: Array.from(ids).filter((id) => !found.has(id)) };
        } else if (action === 'clear_tape') {
            const removed = c.tape.length;
            c.tape = [];
            calcSave();
            calcTapeRenderAll();
            reply = { ok: true, action: action, removed: removed };
        } else if (action === 'set_memory') {
            c.memory = calcAgentNumber(input.value, 'value');
            calcSyncMemoryButtons();
            calcSave();
            reply = { ok: true, action: action };
        } else if (action === 'clear_memory') {
            c.memory = null;
            calcSyncMemoryButtons();
            calcSave();
            reply = { ok: true, action: action };
        } else {
            reply = { ok: false, error: 'Unknown action' };
        }
    } catch (err) {
        reply = { ok: false, action: action, error: (err && err.message) || CALC_ERR_INVALID };
    }
    if (input.open) openDesktopCalculator();
    calcRender();
    reply.memory = c.memory;
    reply.tapeCount = c.tape.length;
    return reply;
}
