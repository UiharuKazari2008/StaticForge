#!/usr/bin/env node
/**
 * Build public/css/vista-scrollbars.css: Windows Vista's scrollbar, 1:1, from Vista's own theme
 * art (Yozora #467). The first version of this sheet was generated from 7.css (khang-nd/7.css),
 * which is Windows 7's scrollbar: close, but an overlay on a VM screenshot shows the flat arrow
 * buttons, the thumb's gloss and the gripper are different. This build keeps 7.css's selector
 * scheme (one button at each end, hover / active per part, the corner) and paints every part
 * with the bitmaps aero.msstyles uses (dumped from the Vista VM with dumpres.exe, un-premultiplied,
 * sliced per state into public/static_images/vista-scrollbar/):
 *
 *   IMAGE_666  17x340  arrow buttons, 20 states: up / down / left / right x normal, hot, pressed,
 *                      disabled, then the four "bar hovered" states  -> arrow-<dir>-<state>.png
 *   IMAGE_667  13x260  the arrow glyphs in the same 20 states          -> glyph-<dir>-<state>.png
 *   IMAGE_678  17x110  vertical thumb, 5 states (normal, hot, pressed, disabled, hover), 17x22
 *                      each; its first and last row are track colour and Vista draws them outside
 *                      the thumb, so thumb-v-<state>.png is rows 1-20: rows 0-3 / 16-19 are the
 *                      caps, the rest repeats -> thumb-v-<state>-mid.png (one row)
 *   IMAGE_677  20x85   horizontal thumb, 5 states, 20x17 each, the same 1 px margin at each end:
 *                      thumb-h-<state>.png is columns 1-18, caps 0-3 / 13-17
 *   IMAGE_671  9x50    vertical thumb gripper, 5 states of 9x10 (IMAGE_672 is the large size) -> gripper-v-<state>.png
 *   IMAGE_669  10x45   horizontal thumb gripper, 5 states of 10x9       -> gripper-h-<state>.png
 *   track               the vertical track is the normal arrow button's own profile (flat):
 *                      track-v.png = arrow-up-normal.png row 8 (#f8 e3 e7 ed ef.. f0.. f1 f2 ea);
 *                      the horizontal track measured on the VM is lighter than the left / right
 *                      button bitmaps, so track-h.png is that measurement (#f8 e1 e5 ea ed x10
 *                      ef f0 e9), built with ImageMagick
 *
 * Metrics measured on the VM (Notepad, 96 dpi): bar 17 px, buttons 17x17, thumb 15 px wide inside
 * a 1 px track column on each side, corner #f0f0f0; the glyphs sit centred except the up arrow,
 * which Vista draws one row higher. The "bar hovered" state (Vista bevels the
 * thumb and arrows while the pointer is anywhere over the bar) has no CSS selector in Chrome, so
 * parts stay in their normal state until the pointer is on them.
 *
 * The desktop sheet inlines the bitmaps. ::-webkit-scrollbar does not use an <img>
 * preload: it paints the flat background, then fetches the file, so the bar flashes
 * a placeholder even when that file is already in the image cache. A data URI is
 * part of the stylesheet and paints with the rule. The frame sheet inlines for the
 * same reason plus the sandboxed message CSP.
 *
 *   node scripts/build-vista-scrollbars.js          # write the file
 *   node scripts/build-vista-scrollbars.js --check  # exit 1 when the file is out of date
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/css/vista-scrollbars.css');
const ART_DIR = path.join(ROOT, 'public/static_images/vista-scrollbar');
const ROOT_SCOPE = 'body.desktop-mode:not(.windows-classic-theme)';
// Every native scrollbar on the desktop, except html (hidden), the JS custom-scrollbar
// containers (customScrollbar.js hides their native bar) and the title toolbars' thin bar.
// Specific enough to beat the app's own thin ::-webkit-scrollbar rules (Yukimi: Vista is the
// default unless a custom scrollbar is used); no !important, so display:none hiders still win.
const SCOPE = `${ROOT_SCOPE} :not(html):not(.has-custom-scrollbar):not(.scrollable-content):not(.form-section-scroll):not(.modal-window-title-toolbar)`;
// Windows whose scroll areas carry the overlay scrollbar (customScrollbar.js, data-custom-scrollbar)
// but are Vista applications and show the native bar instead on the desktop (Yukimi 2026-10-14:
// Periscope's overlay was restyled to imitate a Windows bar and read as neither): the overlay is
// hidden and the inner .scrollable-content scroller gets the same rules.
// Reference Manager and Dovecote (Yukimi 2026-10-14, #474 / #473: "use the vista scrollbar"),
// Config Checkpoints' list box and Apply Studio Change's list (Yukimi 2026-10-21)
const NATIVE_HOSTS = ['#logViewerModal', '#cacheManagerModal', '#desktopDovecoteModal', '#configEditorCheckpointsModal', '#confirmationDialog .studio-change-dialog'];
// one selector per host, never :is(): Chrome drops scrollbar part rules (thumb, button, track with
// :vertical / :start ...) whose selector wraps the host in :is(), while the bare ::-webkit-scrollbar
// rule still matches (seen 2026-10-14, Chromium 1x headless and the desktop tab)
const NATIVE_SCOPES = NATIVE_HOSTS.map((host) => `${ROOT_SCOPE} ${host} .scrollable-content`);

const SIZE = 17;
const BUTTON_STATES = [['', 'normal'], [':hover', 'hot'], [':active', 'pressed'], [':disabled', 'disabled']];
const THUMB_STATES = [['', 'normal'], [':hover', 'hot'], [':active', 'pressed']];
// Chrome's button pseudo-classes: :vertical:start is the top (decrement) button, :vertical:end
// the bottom one; 7.css hides the second button of each pair (:start:increment, :end:decrement)
const BUTTONS = [
    ['vertical:start', 'up'],
    ['vertical:end', 'down'],
    ['horizontal:start', 'left'],
    ['horizontal:end', 'right']
];

// Both sheets inline the art. The frame copy must: sandboxed srcdoc frames (Dovecote's
// message body) allow only data: images. The desktop sheet must too: a file url on
// ::-webkit-scrollbar paints the flat background first, then the bitmap.
function art(name) {
    const file = path.join(ART_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`missing scrollbar art ${name}`);
    return `url("data:image/png;base64,${fs.readFileSync(file).toString('base64')}")`;
}

function rule(selector, decls) {
    return `${selector} {\n${decls.map((d) => `    ${d};`).join('\n')}\n}`;
}

/** The part rules for several scopes at once: each selector is repeated per scope. */
function multiRule(scopes, suffixes, decls) {
    const selectors = [];
    for (const scope of scopes) for (const suffix of suffixes) selectors.push(`${scope}${suffix}`);
    return rule(selectors.join(',\n'), decls);
}

function partRules(scopes) {
    const rules = [];
    const R = (suffix, decls) => rules.push(multiRule(scopes, Array.isArray(suffix) ? suffix : [suffix], decls));
    // The bar's own background is the track bitmap, not a flat stand-in. The track
    // layer is the same image, so the first paint is already the Vista metal.
    R('::-webkit-scrollbar', [`width: ${SIZE}px`, `background: ${art('track-v.png')} repeat-y`]);
    R('::-webkit-scrollbar:horizontal', [`height: ${SIZE}px`, `background: ${art('track-h.png')} repeat-x`]);
    R('::-webkit-scrollbar-corner', ['background: #f0f0f0']);
    R('::-webkit-scrollbar-track:vertical', [`background: ${art('track-v.png')} repeat-y`]);
    R('::-webkit-scrollbar-track:horizontal', [`background: ${art('track-h.png')} repeat-x`]);

    // arrow buttons: the glyph over the button face, one button at each end
    R('::-webkit-scrollbar-button', [
        `width: ${SIZE}px`,
        `height: ${SIZE}px`,
        'background-repeat: no-repeat',
        'background-position: center'
    ]);
    R(['::-webkit-scrollbar-button:vertical:start:increment', '::-webkit-scrollbar-button:vertical:end:decrement', '::-webkit-scrollbar-button:horizontal:start:increment', '::-webkit-scrollbar-button:horizontal:end:decrement'], ['display: none']);
    for (const [pseudo, dir] of BUTTONS) {
        for (const [state, name] of BUTTON_STATES) {
            const decls = [`background-image: ${art(`glyph-${dir}-${name}.png`)}, ${art(`arrow-${dir}-${name}.png`)}`];
            if (dir === 'up') decls.push('background-position: center top 1px, center');
            // the state pseudo-class goes last: Chrome matched :disabled only after :horizontal
            R(`::-webkit-scrollbar-button:${pseudo}${state}`, decls);
        }
    }

    // thumbs: the bitmap's caps as border-image, its middle row / column repeated under the
    // gripper (border-image without fill leaves the middle to the background layers)
    R('::-webkit-scrollbar-thumb', [
        'border-style: solid',
        'border-color: transparent',
        'border-image-repeat: stretch',
        'background-repeat: no-repeat, repeat',
        'background-position: center, 0 0',
        'background-origin: padding-box, border-box',
        'background-clip: border-box'
    ]);
    R('::-webkit-scrollbar-thumb:vertical', ['border-width: 4px 0', 'border-image-slice: 4 0', 'border-image-width: 4px 0']);
    R('::-webkit-scrollbar-thumb:horizontal', ['border-width: 0 5px 0 4px', 'border-image-slice: 0 5 0 4', 'border-image-width: 0 5px 0 4px']);
    // a bar with nothing to scroll shows no thumb on Windows; Chrome would stretch one over the track
    R('::-webkit-scrollbar-thumb:disabled', ['border-image: none', 'background: none']);
    for (const [state, name] of THUMB_STATES) {
        R(`::-webkit-scrollbar-thumb:vertical${state}`, [
            `border-image-source: ${art(`thumb-v-${name}.png`)}`,
            `background-image: ${art(`gripper-v-${name}.png`)}, ${art(`thumb-v-${name}-mid.png`)}`
        ]);
        R(`::-webkit-scrollbar-thumb:horizontal${state}`, [
            `border-image-source: ${art(`thumb-h-${name}.png`)}`,
            `background-image: ${art(`gripper-h-${name}.png`)}, ${art(`thumb-h-${name}-mid.png`)}`
        ]);
    }

    return rules;
}

function build() {
    const rules = partRules([SCOPE]);
    const native = partRules(NATIVE_SCOPES);
    return `/* Vista scrollbars: generated by scripts/build-vista-scrollbars.js from Vista's own
   aero.msstyles bitmaps (public/static_images/vista-scrollbar/, ids in the script). Do not edit
   by hand. The bitmaps are inlined: a ::-webkit-scrollbar file url paints a flat placeholder
   until the response arrives. The desktop's scrollbar everywhere a custom scrollbar
   (customScrollbar.js) is not used; 17 px, flat arrow buttons that light up on hover, the
   glossy thumb with its gripper. */

/* scrollbar-width / scrollbar-color switch Chrome off ::-webkit-scrollbar: reset the places
   that set them to a thin bar, so they get the Vista scrollbar too */
${ROOT_SCOPE} :is(.explorer-grid-scroll, #fileSearchAutofill .character-autocomplete-list) {
    scrollbar-width: auto;
    scrollbar-color: auto;
}

${rules.join('\n\n')}

/* Vista applications that scroll through the overlay scrollbar (customScrollbar.js) show the
   native bar instead on the desktop: the overlay is hidden, the inner scroller is unhidden and
   takes the same parts (NATIVE_HOSTS in the script) */
${NATIVE_HOSTS.map((host) => `${ROOT_SCOPE} ${host} .has-custom-scrollbar > .custom-scrollbar`).join(',\n')} {
    display: none;
}

${NATIVE_SCOPES.join(',\n')} {
    scrollbar-width: auto;
    scrollbar-color: auto;
}

${NATIVE_SCOPES.map((scope) => `${scope}::-webkit-scrollbar`).join(',\n')} {
    display: block;
}

${native.join('\n\n')}
`;
}

/** The same bar for documents inside frames (every element of the frame; art inlined). Dovecote
 * (desktop-apps/dovecote.js) inlines it into its sandboxed message srcdoc on the Vista desktop. */
const FRAME_OUT = path.join(ROOT, 'public/css/vista-scrollbars-frame.css');

function buildFrame() {
    const rules = partRules(['*']);
    return `/* Vista scrollbars for documents inside frames: generated by scripts/build-vista-scrollbars.js
   (do not edit by hand). The bitmaps are inlined as data: URIs for frames whose CSP allows only
   inline styles and data: images. */
html, body, * {
    scrollbar-width: auto;
    scrollbar-color: auto;
}

${rules.join('\n\n')}
`;
}

const outputs = [[OUT, build()], [FRAME_OUT, buildFrame()]];
if (process.argv.includes('--check')) {
    let stale = false;
    for (const [file, text] of outputs) {
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (current !== text) { console.error(`${path.basename(file)} is out of date`); stale = true; }
    }
    if (stale) process.exit(1);
    console.log('vista-scrollbars.css is current');
} else {
    for (const [file, text] of outputs) {
        fs.writeFileSync(file, text);
        console.log(`wrote ${path.relative(ROOT, file)} (${text.length} bytes)`);
    }
}
