/**
 * The output panel (StaticForge #1327, Yukimi, Nov 26 2026: "the Media Output item should have its own popup ... to select
 * audio device"): Quick Access's Output tile (press `qa:output`) and the media session's output button
 * (wmTitanium openOutputSwitcher) open this one popup, drawn by the Android app (CaféReady) from the layout definition
 * written here, so it opens and moves media with the page asleep (cafeready-background). Android's own Media output
 * switcher is not opened any more.
 *
 * LAYOUT DEFINITION (cursor rule melaton-bars-native-layouts). The page lays the popup out (wmQuickAccess.open delegates to
 * build() below) and melatonBars writes it down, like Quick Access, as the roles
 *   output.0 .. output.8     the panel with exactly N rows (N = the outputs the app lists now; output.0 = none)
 * It sits where Quick Access's panel does - the same edge (cfg.side), between the bars, the same tint, frosted glass and
 * width (the strip's 1 or 2 columns, or the wide panel; a strip's row is its picture over the name, the wide panel's row
 * is the picture, the name, then the check) - and takes its place: the app shows the role of its row count
 * and moves its pictures, texts and marks itself.
 *
 * DRAWING LIST (device px, paint order), from the layer's elements:
 *   panel      the Sidebar glass of Quick Access, its two shadow fields (live qa-out / qa-in, as Quick Access's)
 *   head       the text "Audio output" (static)
 *   row i      a highlight box (live out-sel:i), the glyph (7 pictures, live out-g:i:<glyph>), the name (live out-name:i,
 *              a one-line text, ellipsis when it does not fit its box), a check (live out-sel:i), over a hit
 *   output.0   instead of rows one text (live out-empty), drawn as written (its lines are static: output.0 is only
 *              shown when there is no other output)
 *
 * ACTIONS (hits). Row i is a hit `android:out:<i>` (data-android "out:<i>"): the app moves media to the output it lists in
 * row i (MediaOutputRouting.select) and keeps the panel up until the move is done. Nothing else is pressable; a press
 * outside the panel closes it as it closes Quick Access's (the app).
 *
 * LIVE FIELDS (the app fills them from its own route list, one row per device as the volume box's Output combo lists
 * them - wmShell mediaOutputs / outputLabel / outputGlyph - so nothing needs the page):
 *   out-name:<i>        the output's name: one line of text (sample here: "Galaxy Buds2 Pro", in the one-column strip "Speaker").
 *                       Its box: u = the picture's width / 20 (one WM unit, device px). Strip (1 or 2 columns): the name is
 *                       centred on the text's cx and has the row's hit box inset by 2u each side; wide panel: it starts at the
 *                       text's x and ends at the row's hit right edge less 24u (the check's room). A longer name ends in an
 *                       ellipsis at that edge (the page draws it with text-overflow: ellipsis).
 *   out-g:<i>:<glyph>   the row's picture; glyph is one of output, headphones, headset, display, jack, speaker, cast
 *                       (wmShell outputGlyph's names). Seven stacked pictures per row, the app draws the one of the
 *                       output's kind and none of the others (files: /static_images/quickaccess/out-<glyph>.png,
 *                       white, made from wmShell's bitGlyph drawings by scripts/generate-output-glyphs.js)
 *   out-sel:<i>         the highlight box and the check of row i (both fields): drawn only for the output media plays on
 *   out-empty           output.0's text
 *
 * MESSAGE HANDLING. While it is up the app updates it from its own route list (the outputs coming and going: the app
 * swaps the role to the one of the new row count, keeps the panel's edge and shadow) and from the router's state (the
 * current output, after a move). It closes on a press outside it, on the Home / Back keys as Quick Access does, and
 * after a row's press once the move is done or has failed. The page is asked for the layouts again (signature()) when
 * the workspace colour, the side, the layout or the columns change, or when VERSION does.
 */
(function (root) {
    'use strict';
    if (root.wmOutputPanel) return;

    // the panel's most rows: the outputs a phone offers at once (speakers, a wired set, a few Bluetooth, a display, a cast)
    const MAX = 8;
    // bump when the markup or the look changes: the app is sent the layouts again
    const VERSION = 'o1';
    // wmShell outputGlyph's names: the row carries a picture for each, the app draws the output's own
    const GLYPHS = ['output', 'headphones', 'headset', 'display', 'jack', 'speaker', 'cast'];
    // what the box is sized for: a name as One UI gives one (the app's text replaces it). The sample fits its box in every
    // layout (the one-column strip's is the phone's own "Speakers" cut short): the layout writer records a centred line's
    // middle (cx) only for a line that fits, and the app centres the name it fills in there
    const SAMPLE = 'Galaxy Buds2 Pro';
    const SAMPLE_NARROW = 'Speaker';
    const TITLE = 'Audio output';
    const EMPTY = 'No other output is available.';
    // the rows' height in WM units: Quick Access's tile is 36, its wide tile 30; a row is at least as tall, less only when
    // the outputs would not fit between the bars, never below the wide tile's
    const ROW_STRIP = 48;
    const ROW = 40;
    const ROW_MIN = 30;
    const GAP = 4;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** The number of rows of role `output.N`, or null when it is not one of this panel's. */
    function parse(role) {
        const m = /^output\.(\d+)$/.exec(String(role || ''));
        if (!m) return null;
        const n = Number(m[1]);
        return n <= MAX ? n : null;
    }

    /** Every role of the panel: output.0 .. output.8 (the page cannot know how many outputs the phone will list). */
    function roles() {
        return Array.from({ length: MAX + 1 }, (_, i) => `output.${i}`);
    }

    /** What the layouts depend on beyond Quick Access's own settings (the markup's make). */
    function signature() {
        return VERSION;
    }

    function row(i, sample) {
        const pics = GLYPHS.map((g) => `<span class="op-g is-${g}" data-live="out-g:${i}:${g}"></span>`).join('');
        // (the highlight first: behind the picture and the name; the check and highlight are drawn for the current output only)
        return `<button type="button" class="op-row" data-android="out:${i}" aria-label="Output ${i + 1}">`
            + `<span class="op-hl" data-live="out-sel:${i}"></span>`
            + `<span class="op-gs">${pics}</span>`
            + `<span class="op-name" data-live="out-name:${i}">${esc(sample)}</span>`
            + `<span class="op-mark" data-live="out-sel:${i}"></span>`
            + '</button>';
    }

    /**
     * Fills `layer` (the popup wmQuickAccess.open made: edge, tint, place, is-wide / is-cols-N) with the panel of `n` rows.
     * o: { wide, cols, room } - the Quick Access layout and the room between the bars in WM units (rows shrink to fit it).
     */
    function build(layer, n, o) {
        const wide = !!(o && o.wide);
        const cols = o && o.cols === 2 ? 2 : 1;
        // (the strip's title: two lines in its one column, one in the two-column strip and the wide panel)
        const head = wide || cols === 2 ? 18 : 26;
        let h = wide ? ROW : ROW_STRIP;
        if (n > 0 && o && o.room > 0) {
            // the glass's padding (top 4 / 6 wide, bottom 6), the title, then the rows and their gaps
            const free = o.room - (wide ? 12 : 10) - head - GAP * (n - 1);
            h = Math.max(ROW_MIN, Math.min(h, Math.floor(free / n)));
        }
        layer.classList.add('is-output');
        layer.style.setProperty('--op-row', String(h));
        layer.innerHTML = '<div class="qa-panel"><span class="qa-drop" data-live="qa-out"></span><span class="qa-inset" data-live="qa-in"></span>'
            + `<div class="op-head">${esc(TITLE)}</div>`
            + (n > 0
                ? `<div class="op-rows">${Array.from({ length: n }, (_, i) => row(i, !wide && cols === 1 ? SAMPLE_NARROW : SAMPLE)).join('')}</div>`
                : `<div class="op-empty" data-live="out-empty">${esc(EMPTY)}</div>`)
            + '</div>';
        return true;
    }

    root.wmOutputPanel = { parse, roles, signature, build, MAX, VERSION, GLYPHS };
})(window);
