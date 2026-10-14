#!/usr/bin/env node
// Calculator as Vista's calc.exe (Yozora #493): the window takes the light client, a menu bar
// (Edit, View, Help) replaces the caption toggles, the keypad is calc.exe's arrangement with its
// caption colours, and the window is fixed-size per mode. Run: node scripts/test-vista-calculator.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/vista-calculator.css');
const base = read('public/css/desktop-apps/desktopAppWindows.css');
const js = read('public/scripts/comp/desktop-apps/calculator.js');
const html = read('public/app.html');
const G = 'body.desktop-mode:not(.windows-classic-theme)';

// wiring
assert.ok(html.includes('<link rel="stylesheet" href="/css/vista-visual-index.css">\n    <link rel="stylesheet" href="/css/vista-calculator.css">'), 'sheet linked after vista-visual-index.css');
assert.ok(html.includes('scripts/comp/desktop-apps/calculator.js'), 'calculator.js loads');
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/app_icons/vista-calculator.png')), 'calc.exe icon exists');
assert.ok(js.includes("titleImage.src = '/static_images/app_icons/vista-calculator.png'") && js.includes("titleIcon.className = 'fas fa-calculator icon-fa'"), 'caption: Font Awesome glyph plus the program icon');

// keyboard characters only in the new text (existing key labels are \u escapes)
for (const [file, text] of [['vista-calculator.css', css], ['calculator.js', js], ['desktopAppWindows.css', base]]) {
    assert.ok(!/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00d7\u2212\u00a0]/.test(text), `${file}: keyboard characters only`);
}

// light client on the Vista desktop only; fixed-size window; menu bar instead of the caption toolbar
assert.ok(js.includes("if (on) modal.dataset.windowClient = 'light';") && js.includes("els.content.classList.toggle('win7', on);") && js.includes("els.content.classList.toggle('dark', !on);"), 'light client: data-window-client="light" + .win7, dark client off the desktop');
assert.ok(js.includes("modal.classList.toggle('resizeable-window', !on);"), 'not resizable on the Vista desktop');
assert.ok(js.includes("modal.classList.toggle('toolbar-visible', !on);") && css.includes(`${G} #desktopCalculatorModal .modal-window-title-toolbar {\n    display: none;`), 'the caption toolbar goes off on the Vista desktop');
assert.ok(js.includes("b.contains('desktop-mode') && !b.contains('windows-classic-theme')"), 'Vista gate reads the body classes');
assert.ok(js.includes("attributeFilter: ['class']"), 'the structure follows body class changes');
assert.ok(js.includes('DESKTOP_CALCULATOR_VISTA_WIDTHS = { standard: 270,'), "Standard is calc.exe's 270 px window");
assert.ok(js.includes('modal.style.width = modal.dataset.windowDefaultWidth + \'px\';'), 'the fixed width is applied per mode');
assert.ok(js.includes('const hug = content ? modal.offsetHeight - content.offsetHeight + content.scrollHeight : modal.offsetHeight;'), "the hug height is the client's real extent (the last key row included)");
assert.ok(js.includes("const stretching = fixed ? '.modal-body, .form-col' :"), 'a fixed layout keeps its key sizes while measuring');
assert.ok(js.includes('openModal(modal);\n        // the fixed-size window re-measures once visible') && js.includes('if (desktopCalcEls.vista) calcRefitHeight();'), 'the window re-measures once it is visible');
assert.ok(css.includes(`${G} #desktopCalculatorModal .modal-body {\n    flex: none;`), 'the client hugs the keypad');

// menu bar: the shared .naxt-menubar markup, click menus from contextMenu.js
assert.ok(js.includes("menubar.className = 'naxt-menubar'") && js.includes("['Edit', 'View', 'Help'].map("), 'Edit View Help titles');
assert.ok(js.includes("calcCreateButton('naxt-menu-title'"), 'titles are .naxt-menu-title buttons');
assert.ok(js.includes('contextMenu.attachClickMenuToElement(button, {'), 'dropdowns are click context menus');
assert.ok(js.includes("badge: 'Ctrl+C'") && js.includes("badge: 'Ctrl+V'"), 'Edit: Copy Ctrl+C, Paste Ctrl+V');
assert.ok(js.includes("indicatorMark: 'radio', checked: desktopCalc.mode === name"), 'View: radio mark on the current mode');
assert.ok(js.includes("{ text: 'History', action: 'tape', showIndicator: true, checked:"), 'View: History toggles the tape');
assert.ok(js.includes("{ text: 'About Calculator', icon: 'fas fa-calculator', action: 'about' }") && js.includes("{ title: 'About Calculator', icon: 'fas fa-calculator' }"), 'Help: About Calculator opens a message box');
assert.ok(css.includes(`${G} #desktopCalculatorModal .naxt-menubar {`) && css.includes('height: 19px;') && css.includes('background: linear-gradient(#fefeff, #e5eaf5 7px, #d4dbed 7px, #e1e6f6 18px);'), "the menu bar is Vista's 19 px band");

// the Standard keypad: calc.exe's arrangement
const layouts = /const DESKTOP_CALCULATOR_LAYOUTS = (\{[\s\S]*?\n\});/.exec(js);
assert.ok(layouts, 'layouts found');
const LAYOUTS = new Function('return ' + layouts[1])();
assert.deepStrictEqual(LAYOUTS.standard, [
    ['backspace', 'ce', 'clear'],
    ['mc', '7', '8', '9', '/', 'sqrt'],
    ['mr', '4', '5', '6', '*', 'percent'],
    ['ms', '1', '2', '3', '-', 'recip'],
    ['mplus', '0', 'sign', '.', '+', '=']
], 'Standard: Backspace CE C, then MC 7 8 9 / sqrt ... M+ 0 +/- . + =');
assert.ok(!LAYOUTS.standard.flat().includes('mminus'), 'no M- in Standard');
assert.ok(!LAYOUTS.scientific.flat().includes('second') && !LAYOUTS.scientific.flat().includes('angle'), 'Inv and the angle unit are controls, not keys');
assert.deepStrictEqual(LAYOUTS.scientific[0], ['backspace', 'ce', 'clear'], 'Scientific status row');
assert.deepStrictEqual(LAYOUTS.scientific.slice(1).map((row) => row[3]), ['mc', 'mr', 'ms', 'mplus', 'mminus'], "Scientific: calc.exe's memory column before the digit block");
assert.deepStrictEqual(LAYOUTS.scientific.slice(1, 5).map((row) => row.slice(4, 8)), [['7', '8', '9', '/'], ['4', '5', '6', '*'], ['1', '2', '3', '-'], ['0', 'sign', '.', '+']], 'Scientific: the digit block and operator column');
assert.deepStrictEqual(LAYOUTS.programmer[LAYOUTS.programmer.length - 1].slice(2), ['A', 'B', 'C', 'D', 'E', 'F'], 'Programmer: the A-F row under the digit block');
for (const mode of Object.keys(LAYOUTS)) {
    assert.deepStrictEqual(LAYOUTS[mode][0], ['backspace', 'ce', 'clear'], `${mode}: the status row holds Backspace CE C`);
}
assert.ok(js.includes("if (rowIndex === 0) {\n            rowEl.dataset.calcRow = 'status';") && js.includes("rowEl.appendChild(calcBuildStatusBox('memory'));"), 'the status row carries the memory box');
assert.ok(js.includes("calcBuildChoice('checkbox', 'desktopCalculatorInv', 'Inv', { calcKey: 'second' })") && js.includes("calcBuildChoice('checkbox', 'desktopCalculatorHyp', 'Hyp', { calcHyp: '1' })"), 'Inv and Hyp check boxes');
assert.ok(js.includes("calcBuildChoice('radio', 'desktopCalculatorAngle-' + angle") && js.includes("calcBuildChoice('radio', 'desktopCalculatorBase-' + base"), 'angle and base radio groups');
assert.ok(js.includes("DESKTOP_CALCULATOR_HYP_KEYS = { sin: 'sinh', cos: 'cosh', tan: 'tanh', asin: 'asinh', acos: 'acosh', atan: 'atanh' }"), 'Hyp remaps the trig keys');
assert.ok(js.includes("box.textContent = empty ? '' : 'M';") && js.includes("box.textContent = depth > 0 ? '(=' + depth : '';"), 'M and (=n boxes');

// the look: 7.css standard buttons at calc.exe's 34x27, the sunken boxes, the text-box display
assert.ok(css.includes('flex: 0 0 34px;\n    width: 34px;\n    min-width: 0;\n    height: 27px;'), 'keys are 34x27');
assert.ok(css.includes('flex: 0 0 60px;') && css.includes('flex-basis: 61px;\n    margin-left: auto;'), 'Backspace CE C are 61 / 60 / 60 and right-aligned');
assert.ok(css.includes('gap: 5px;\n    height: 27px;'), 'keys 5 px apart');
assert.ok(css.includes('height: 23px;\n    min-height: 0;\n    margin: 0 0 13px;') && css.includes('border-color: #abadb3 #dbdfe6 #e3e9ef #e2e3ea;') && css.includes('text-align: right;'), "the display is Vista's 23 px text box, right-aligned");
assert.ok(css.includes('width: 27px;\n    min-width: 0;\n    height: 26px;') && css.includes('border-color: #a0a0a0 #fff #fff #a0a0a0;\n    border-radius: 0;\n    box-shadow: inset 1px 1px 0 #696969, inset -1px -1px 0 #e3e3e3;'), 'the memory box is the 27x26 sunken box');
assert.ok(css.includes('color: #ff0000;') && css.includes('color: #0000ff;') && css.includes('color: #ff00ff;'), 'red, blue and magenta captions');
assert.ok(css.includes('[data-calc-key="backspace"], [data-calc-key="ce"], [data-calc-key="clear"],') && css.includes('[data-calc-key="mc"], [data-calc-key="mr"], [data-calc-key="ms"], [data-calc-key="mplus"], [data-calc-key="mminus"],'), 'Backspace CE C and the memory keys are red');
assert.ok(css.includes('[data-calc-key="sign"], [data-calc-key="."], [data-calc-key="pi"], [data-calc-key="e"],'), 'digits, +/- and . are blue');
assert.ok(css.includes('--w7-rd-size: 13px;\n    --w7-rdl-space: 4px;\n    --w7-rd-left: 17px;') && css.includes('--w7-cb-size: 13px;'), '7.css radios and check boxes at 13 px');
assert.ok(css.includes('#desktopCalculatorTapeList {\n    gap: 0;\n    padding: 1px;\n    background: #fff;'), 'the tape is a white list');
assert.ok(css.includes('container-type: normal;'), 'the fixed widths replace the container queries');
const gated = css.split('\n').filter((line) => /^[#.\[a-z]/.test(line) && !line.startsWith(G));
assert.deepStrictEqual(gated, [], 'every selector is gated on the Vista desktop');

// the base structure rules follow the new markup
assert.ok(base.includes('#desktopCalculatorModal [data-calc-pad] > .form-row > button,') && base.includes('#desktopCalculatorModal [data-calc-box] {') && base.includes('#desktopCalculatorModal fieldset {'), 'base rules for rows, boxes and groups');
assert.ok(!base.includes('.form-group > button'), 'the .form-group wrappers are gone');
console.log('test-vista-calculator: ok');
