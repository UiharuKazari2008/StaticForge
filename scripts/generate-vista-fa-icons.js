#!/usr/bin/env node
/**
 * Writes public/css/vista-fa-icons.css: Vista's own 16 px art painted on the Font Awesome <i> that
 * context menus (contextMenu.js) and command bars build, per .cursor/rules/vista-icons-not-fa.mdc.
 * Edit the tables below, then run:  node scripts/generate-vista-fa-icons.js
 *
 * MAP        [art, where it came from, glyph classes]  (one glyph belongs to one picture)
 * OVERRIDES  [data-menu-text match, glyph, art or null for text only]  for menu items whose glyph means
 *            something else
 *            elsewhere (contextMenu.js sets data-menu-text from the item's label)
 * NO_VISTA   glyphs with no Vista counterpart, listed in the sheet's last comment: a menu row with one
 *            goes text only (any unmapped glyph does), icon-only buttons keep Font Awesome
 *
 * New 16 px art goes in public/static_images/vista-cmdbar/ (rip it from the Vista VM:
 * docs/vista-vm-agent.md). app_icons/16/*.webp are built at runtime from the app_icons masters.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CB = '/static_images/vista-cmdbar/';
const VI = '/static_images/vista-icons/';
const IE = '/static_images/vista-ie/';
const EX = '/static_images/vista-explorer/';
const CP = '/static_images/vista-cpl/';
const AP = '/static_images/app_icons/16/';
const CTL = '/static_images/vista-controls/';

const MAP = [
    [CB + 'cut.png', 'shell32 259', ['fa-cut', 'fa-scissors']],
    [CB + 'copy.png', 'Photo Gallery', ['fa-copy', 'fa-clipboard', 'nai-clipboard']],
    [CB + 'paste.png', 'shell32 260', ['fa-paste']],
    [CB + 'delete.png', 'shell32 131', [
        'fa-trash', 'fa-trash-alt', 'fa-trash-can', 'fa-xmark', 'fa-times', 'fa-xmark-large', 'fa-circle-xmark',
        'fa-times-circle', 'fa-folder-minus', 'mdi-delete'
    ]],
    [CB + 'rename.png', 'shell32 133', ['fa-pen', 'fa-i-cursor', 'fa-pen-field']],
    [CB + 'properties.png', 'shell32 269', [
        'fa-sliders', 'fa-cog', 'fa-gear', 'fa-edit', 'fa-pen-to-square', 'fa-file-pen', 'fa-glasses-round'
    ]],
    [CB + 'move-to.png', 'shell32 132', ['fa-folder-arrow-up', 'fa-file-import']],
    ['/static_images/vista-file-dialog/new-folder.png', 'Explorer', ['fa-folder-plus']],
    [CB + 'save.png', 'shell32 258', ['fa-save', 'fa-floppy-disk']],
    [CB + 'refresh.png', 'shell32 238', ['fa-sync', 'fa-sync-alt', 'fa-rotate', 'fa-arrows-rotate', 'mdi-refresh']],
    [CB + 'restore.png', 'shell32 239', ['fa-inbox']],
    [CB + 'restore-point.png', 'rstrui', ['fa-clock-rotate-left']],
    [CB + 'clear.png', 'shell32 271', ['fa-broom', 'fa-broom-wide']],
    [CB + 'find.png', 'shell32 270', ['fa-file-magnifying-glass']],
    [CB + 'new.png', 'shell32 205', ['fa-file', 'fa-file-circle-plus']],
    [CB + 'select-all.png', 'Explorer', ['fa-check-square', 'fa-square-check', 'fa-square-dashed', 'fa-check-double']],
    [CB + 'select-none.png', 'Explorer', ['fa-square']],
    [CB + 'favorites.png', 'shell32 43', ['fa-star', 'fa-file-heart']],
    [CB + 'go.png', 'shell32 176', [
        'fa-right-to-bracket', 'fa-arrow-right-to-bracket', 'fa-location-arrow', 'fa-crosshairs',
        'fa-location-crosshairs', 'fa-location-dot'
    ]],
    [CB + 'checklist.png', 'shell32 165', ['fa-list-check', 'fa-clipboard-list']],
    [CB + 'ban.png', 'shell32 109', ['fa-ban', 'fa-empty-set', 'fa-user-slash', 'fa-image-slash', 'fa-bookmark-slash']],
    [CB + 'power.png', 'shell32 27', ['fa-power-off', 'fa-right-from-bracket']],
    [CB + 'recycle-bin.png', 'shell32 32', ['fa-bin-recycle', 'fa-recycle']],
    [CB + 'clock.png', 'shell32 265', ['fa-clock', 'fa-hourglass-half']],
    [CB + 'music.png', 'shell32 116', ['fa-music']],
    [CB + 'keyboard.png', 'shell32 173', ['fa-keyboard']],
    [CB + 'chip.png', 'shell32 12', ['fa-microchip', 'fa-memory']],
    [CB + 'display.png', 'shell32 15', ['fa-display', 'fa-laptop', 'fa-tv']],
    [CB + 'desktop.png', 'shell32 34', ['fa-window-alt', 'fa-arrow-down-left']],
    [CB + 'wireless.png', 'shell32 243', ['fa-wifi', 'fa-globe-wifi', 'fa-tower-broadcast']],
    [CB + 'shield.png', 'shell32 244', ['fa-shield-halved', 'fa-shield', 'fa-user-shield']],
    [CB + 'text-document.png', 'shell32 70', ['fa-file-lines', 'fa-file-alt', 'fa-subtitles']],
    [CB + 'shortcut.png', 'shell32 263', ['fa-link', 'fa-link-horizontal']],
    [CB + 'internet.png', 'shell32 13', ['fa-globe', 'fa-earth-americas']],
    [CB + 'folder.png', 'imageres 3', ['fa-folder', 'fa-folder-open', 'fa-folder-tree']],
    [CB + 'document.png', 'imageres 1', ['fa-file-code-alt']],
    [CB + 'picture.png', 'imageres 66', ['fa-image', 'fa-image-polaroid', 'nai-img2img']],
    [CB + 'image-file.png', 'imageres 125', ['fa-file-image']],
    [CB + 'film.png', 'imageres 180', ['fa-film', 'fa-video']],
    [CB + 'font.png', 'imageres 117', ['fa-font', 'fa-font-case', 'fa-text', 'fa-heading']],
    [CB + 'lock.png', 'imageres 53', ['fa-lock']],
    [CB + 'zip-folder.png', 'imageres 151', ['fa-file-zipper', 'fa-box-archive']],
    [CB + 'presentation.png', 'imageres 97', ['fa-chalkboard']],
    [CB + 'gears.png', 'imageres 108', ['fa-gears', 'fa-cogs']],
    [CB + 'pie-chart.png', 'imageres 182', ['fa-chart-pie']],
    [CB + 'contacts.png', 'imageres 167', ['fa-address-book', 'fa-address-card']],
    [CB + 'mail.png', 'imageres 14', ['fa-envelope-open', 'fa-envelope-open-text']],
    [CB + 'calendar.png', 'WinCal.exe 0', [
        'fa-calendar', 'fa-calendar-days', 'fa-calendar-day', 'fa-calendar-check', 'fa-calendar-alt',
        'fa-calendar-star'
    ]],
    [CB + 'undo.png', 'shell32 IDB_TB_SH 8', ['fa-undo', 'fa-rotate-left', 'nai-dot-reset']],
    [CB + 'redo.png', 'shell32 IDB_TB_SH 9', ['fa-redo', 'fa-rotate-right']],
    [CB + 'sort.png', 'shell32 IDB_TB_SH 24', [
        'fa-sort', 'fa-sort-amount-down', 'fa-sort-alpha-down', 'fa-arrow-down-wide-short', 'fa-arrow-down-arrow-up'
    ]],
    [CB + 'history.png', 'shell32 IDB_TB_IE 12', ['fa-history']],
    [CB + 'new-window.png', 'shell32 IDB_TB_IE 14', [
        'fa-window', 'fa-window-restore', 'fa-external-link-alt', 'fa-up-right-from-square', 'fa-window-maximize'
    ]],
    [CB + 'note.png', 'shell32 IDB_TB_IE 15', ['fa-sticky-note', 'fa-note-sticky', 'fa-note', 'fa-memo']],
    [CB + 'add.png', 'shell32 IDB_TB_IE 22', [
        'fa-plus', 'fa-plus-circle', 'fa-plus-large', 'fa-grid-round-2-plus', 'fa-user-plus'
    ]],
    [CB + 'discuss.png', 'shell32 IDB_TB_IE 18', [
        'fa-comment', 'fa-comments', 'fa-comment-dots', 'fa-comment-lines', 'fa-message', 'fa-thought-bubble',
        'fa-comment-exclamation'
    ]],
    [CB + 'attach.png', 'msoeres 40 #49', ['fa-paperclip']],
    [CB + 'reply.png', 'msoeres 40 #32', ['fa-reply']],
    [CB + 'reply-all.png', 'msoeres 40 #33', ['fa-reply-all']],
    [CB + 'mail-forward.png', 'msoeres 40 #9', ['fa-share']],
    [CB + 'send.png', 'msoeres 40 #47', ['fa-paper-plane']],
    [CB + 'move-up.png', 'msoeres 40 #51', ['fa-arrow-up', 'fa-chevron-up', 'fa-angles-up', 'fa-chevron-double-up']],
    [CB + 'move-down.png', 'msoeres 40 #50', ['fa-arrow-down', 'fa-chevron-down', 'fa-angles-down']],
    [CB + 'play.png', 'filemgmt 225 #0', ['fa-play', 'fa-forward']],
    [CB + 'stop.png', 'filemgmt 225 #1', ['fa-stop']],
    [CB + 'pause.png', 'filemgmt 225 #2', ['fa-pause']],
    [CB + 'back.png', 'Explorer', ['fa-arrow-left', 'fa-chevron-left']],
    [CB + 'forward.png', 'Explorer', ['fa-arrow-right', 'fa-chevron-right']],
    [CB + 'download.png', 'IE7', ['fa-download', 'fa-arrow-down-to-bracket', 'fa-laptop-arrow-down']],
    [CB + 'upload.png', 'Explorer', ['fa-upload', 'fa-cloud-arrow-up', 'fa-arrow-up-from-bracket', 'fa-file-export']],
    [CB + 'replace.png', 'Explorer', ['fa-exchange-alt', 'fa-arrow-right-arrow-left', 'fa-right-left']],
    [CB + 'contrast.png', 'shell32 174', ['fa-circle-half-stroke', 'fa-adjust', 'fa-diamond-half-stroke']],
    [CB + 'paint-eraser.png', 'mspaint', ['fa-eraser']],
    [CB + 'paint-brush.png', 'mspaint', ['fa-paint-brush', 'fa-paintbrush', 'fa-brush']],
    [CB + 'photo-gallery.png', 'WindowsPhotoGallery.exe 0', ['fa-images']],
    [CB + 'expand-canvas.png', 'Photo Gallery', ['mdi-relative-scale']],
    [CB + 'upscale.png', 'Photo Gallery', ['nai-upscale', 'fa-arrow-up-right-dots']],
    [CB + 'action-pane.png', 'mmc.exe 202', ['fa-columns', 'fa-sidebar']],
    [VI + 'search-16.png', 'shell32', ['fa-search', 'fa-magnifying-glass']],
    [VI + 'info-16.png', 'imageres 75', ['fa-info-circle', 'fa-circle-info', 'fa-info']],
    [VI + 'warning-16.png', 'imageres 78', [
        'fa-triangle-exclamation', 'fa-exclamation-triangle', 'fa-circle-exclamation', 'fa-file-exclamation'
    ]],
    [VI + 'check-16.png', 'mmc.exe 138', ['fa-check', 'fa-circle-check']],
    [VI + 'volume-high-16.png', 'SndVolSSO', ['fa-volume-high']],
    [VI + 'net-disconnected-16.png', 'pnidui', ['fa-unlink', 'fa-link-slash']],
    [VI + 'run-16.png', 'shell32', ['fa-terminal']],
    [IE + 'search.png', 'IE7', ['fa-google']],
    [IE + 'zoom.png', 'IE7', ['fa-search-plus', 'fa-magnifying-glass-plus']],
    [IE + 'print.png', 'IE7', ['fa-print']],
    [IE + 'home.png', 'IE7', ['fa-home', 'fa-house']],
    [CB + 'tools.png', 'ieframe.dll bitmap 699 #7 (IE7 Tools, with alpha)', ['fa-wrench', 'fa-toolbox', 'fa-hammer', 'fa-screwdriver-wrench']],
    [IE + 'feeds.png', 'IE7', ['fa-rss']],
    [IE + 'favorites-add.png', 'IE7', ['fa-bookmark']],
    [EX + 'help-16.png', 'Explorer', ['fa-question', 'fa-question-circle', 'fa-circle-question']],
    [EX + 'organize.png', 'Explorer', ['fa-arrows-up-down-left-right']],
    [EX + 'views-list.png', 'Explorer', ['fa-list', 'fa-list-ol', 'fa-rectangle-list']],
    [EX + 'computer-16.png', 'Explorer', ['fa-computer', 'fa-hard-drive']],
    [CP + 'bulb-16.png', 'Control Panel', ['fa-lightbulb', 'fa-lightbulb-on']],
    [CP + 'key-16.png', 'Control Panel', ['fa-key', 'fa-key-skeleton-left-right']],
    [CP + 'users-16.png', 'Control Panel', ['fa-user', 'fa-user-group', 'fa-user-clock']],
    [CP + 'network-16.png', 'Control Panel', ['fa-network-wired', 'fa-sitemap', 'fa-plug', 'fa-server']],
    [CP + 'windows-update-16.png', 'Control Panel', ['fa-cloud-arrow-down']],
    [AP + 'studio.webp', 'Studio', ['fa-compass-drafting', 'fa-weight-scale']],
    [AP + 'art.webp', 'Workspaces (the gallery)', ['fa-film-canister']],
    [AP + 'spellcaster.webp', 'Spellcaster', ['fa-hat-wizard', 'fa-dice-three']],
    [AP + 'presetbook.webp', 'Spellbook', ['fa-book-spells']],
    [AP + 'ref.webp', 'Reference', ['fa-swatchbook', 'nai-precise-reference', 'nai-vibe-transfer']],
    [AP + 'director.webp', 'Director', ['fa-clapperboard']],
    [AP + 'alchemy.webp', 'Alchemy', ['fa-atom']],
    [AP + 'test_tube.webp', 'Atelier', ['fa-flask']],
    [AP + 'vista-journal.webp', 'Notion', ['fa-notebook']],
    [AP + 'vista-messenger.webp', 'Chat', ['fa-messages', 'fa-person-to-portal']],
    [AP + 'remote_desktop.webp', 'Remote Desktop Manager', ['fa-satellite-dish']],
    [AP + 'vista-remote-desktop.webp', 'Remote Desktop Connection', ['fa-desktop']],
    [AP + 'vista-mail.webp', 'Dovecote', ['fa-envelope']],
    [AP + 'vista-teleport.webp', 'Teleport', ['fa-planet-moon']],
    [AP + 'planet.webp', 'planets, Data Management', ['fa-planet-ringed', 'fa-database', 'fa-solar-system']],
    [AP + 'expanders.webp', 'Expanders', ['fa-book-font']],
    [AP + 'vista-regedit.webp', 'Runes', ['fa-binary']],
    [AP + 'characters.webp', 'Characters', ['fa-users']],
    [AP + 'vista-performance.webp', 'Periscope', ['fa-wave-square']],
    [AP + 'vista-control-panel.webp', 'Control Panel', ['fa-gauge']],
    [AP + 'vista-calculator.webp', 'Calculator', ['fa-calculator']],
    [AP + 'vista-sidebar.webp', 'Sidebar', ['fa-sidebar-flip']],
    [AP + 'agora.webp', 'Agora', ['fa-landmark']],
    [AP + 'vista-date-time.webp', 'Alarm Clock', ['fa-alarm-clock', 'fa-timer']],
    [AP + 'emotion.webp', 'eMotion LIVE', ['fa-photo-film']],
    [AP + 'quips.webp', 'Dynamic Quips', ['fa-comment-heart']],
    [AP + 'vista-phasewalker.webp', 'Phasewalker', ['fa-layer-group']],
    [AP + 'vista-iexplore.webp', 'Grimoire', ['fa-books', 'fa-book']],
    [AP + 'novel.webp', 'Novels', ['fa-book-open']],
    [AP + 'dna.webp', 'Enshutsuka (Memories)', ['fa-box-open-full']],
    [AP + 'vista-personalization.webp', 'Personalize', ['fa-paint-roller']],
    [AP + 'vista-appearance.webp', 'Window Color and Appearance', ['fa-palette']],
    [AP + 'vista-games.webp', 'Games Explorer', ['fa-trophy']],
    [AP + 'vista-easy-transfer.webp', 'Import', ['nai-import']],
    [AP + 'vista-code-file.webp', 'code file', ['fa-code', 'fa-file-code', 'fa-brackets-curly']],
];

// items whose glyph means something else elsewhere
// command buttons whose glyph means something else on that button: [button selector, art, why]
const BUTTON_OVERRIDES = [
    ['#directorToolsBtn', CB + 'action-pane.png', 'the Director\'s menu (sessions and settings): MMC\'s Actions (Yukimi)'],
];

const OVERRIDES = [
    ['[data-menu-text^="Large ("]', 'fa-expand', EX + 'views-icons-lg.png'],
    ['[data-menu-text^="Medium ("]', 'fa-circle', EX + 'views-icons-md.png'],
    ['[data-menu-text^="Small ("]', 'fa-compress', EX + 'views-icons-sm.png'],
    ['[data-menu-text^="Open Melaton Update"]', '*', CP + 'windows-update-16.png'],
    ['[data-menu-text="Check for updates"]', '*', CP + 'windows-update-16.png'],
    ['[data-menu-text="Software Update"]', '*', CP + 'windows-update-16.png'],
    ['[data-menu-text="Open in Notion"]', '*', AP + 'vista-journal.webp'],
    ['[data-menu-text="Move to..."]', '*', CB + 'move-to.png'],
    ['[data-menu-text="Properties"]', '*', CB + 'properties.png'],
    ['[data-menu-text="Refresh"]', '*', CB + 'refresh.png'],
    ['[data-menu-text="Delete"]', '*', CB + 'delete.png'],
    ['[data-menu-text="Select All"]', '*', CB + 'select-all.png'],
    ['[data-menu-text="Deselect All"]', '*', CB + 'select-none.png'],
    ['[data-menu-text="Grimoire"]', '*', AP + 'vista-iexplore.webp'],
    ['[data-menu-text="Search Wiki"]', '*', AP + 'vista-iexplore.webp'],
    ['[data-menu-text="Prompt guide"]', '*', AP + 'vista-iexplore.webp'],
    ['[data-menu-text="Phasewalker"]', '*', AP + 'vista-phasewalker.webp'],
    ['[data-menu-text="PhaseWalker"]', '*', AP + 'vista-phasewalker.webp'],
    ['[data-menu-text="Chat"]', '*', AP + 'vista-messenger.webp'],
    ['[data-menu-text="Personalize"]', '*', AP + 'vista-personalization.webp'],
    // glyphs that open a program elsewhere, on rows that don't
    ['[data-menu-text="Jump to Image"]', 'fa-film-canister', null],
    ['[data-menu-text="Noise Schedule"]', 'fa-wave-square', null],
    ['[data-menu-text="Reset"]', '*', null],
];

// Not every menu row needs an icon (Yukimi): a row keeps its picture only for the commands Explorer's
// Organize menu draws with one (by glyph here, or by label in OVERRIDES), or when it opens a program
// (that program's own icon). Every other row reads as words; the art above still shows on icon-only
// buttons (menu icon rows and grids, command bars).
const MENU_ROW_GLYPHS = new Set([
    // Organize-menu commands
    'fa-cut', 'fa-scissors', 'fa-copy', 'fa-clipboard', 'nai-clipboard', 'fa-paste', 'fa-trash', 'fa-trash-alt',
    'fa-trash-can', 'mdi-delete', 'fa-i-cursor', 'fa-pen', 'fa-folder-arrow-up', 'fa-folder-plus', 'fa-save',
    'fa-floppy-disk', 'fa-undo', 'fa-redo', 'fa-check-square', 'fa-square-check', 'fa-square-dashed',
    // rows that open a program
    'fa-compass-drafting', 'fa-weight-scale', 'fa-film-canister', 'fa-hat-wizard', 'fa-book-spells', 'fa-swatchbook',
    'fa-clapperboard', 'fa-atom', 'fa-flask', 'fa-notebook', 'fa-messages', 'fa-satellite-dish', 'fa-desktop',
    'fa-envelope', 'fa-planet-moon', 'fa-planet-ringed', 'fa-database', 'fa-solar-system', 'fa-book-font',
    'fa-binary', 'fa-users', 'fa-wave-square', 'fa-gauge', 'fa-calculator', 'fa-sidebar-flip', 'fa-landmark',
    'fa-alarm-clock', 'fa-timer', 'fa-photo-film', 'fa-comment-heart', 'fa-books', 'fa-box-open-full',
    'fa-paint-roller', 'fa-trophy', 'nai-import'
]);

// no Vista counterpart: a context menu row goes text only (Vista's menus mostly are); icon-only buttons
// (menu icon rows, command bars) keep Font Awesome
const NO_VISTA = [
    'fa-align-left', 'fa-arrows-left-right', 'fa-bars', 'fa-blender', 'fa-blinds', 'fa-bolt', 'fa-bomb',
    'fa-book-atlas', 'fa-bracket-square', 'fa-bracket-square-right', 'fa-bullhorn', 'fa-chess-board', 'fa-child',
    'fa-circle', 'fa-clone', 'fa-code-branch', 'fa-code-commit', 'fa-code-compare', 'fa-compress', 'fa-crown',
    'fa-cube', 'fa-dial', 'fa-dice', 'fa-distribute-spacing-horizontal', 'fa-dollar-sign', 'fa-down-to-dotted-line',
    'fa-dragon', 'fa-droplet', 'fa-egg', 'fa-expand', 'fa-eye', 'fa-eye-dropper', 'fa-eye-slash', 'fa-fan',
    'fa-feather', 'fa-file-signature', 'fa-fill-drip', 'fa-filter', 'fa-fire', 'fa-flag', 'fa-flag-usa',
    'fa-gauge-high', 'fa-gauge-low', 'fa-gem', 'fa-ghost', 'fa-gift', 'fa-grip-lines', 'fa-hand', 'fa-hashtag',
    'fa-heart', 'fa-high-definition', 'fa-icicles', 'fa-knife-kitchen', 'fa-leaf', 'fa-level-down-alt', 'fa-minus',
    'fa-objects-column', 'fa-paragraph', 'fa-party-horn', 'fa-pen-fancy', 'fa-person-running', 'fa-plane-departure',
    'fa-pray', 'fa-rainbow', 'fa-repeat', 'fa-scale-balanced', 'fa-seedling', 'fa-shirt', 'fa-shopping-bag',
    'fa-shuffle', 'fa-sparkle', 'fa-sparkles', 'fa-star-and-crescent', 'fa-tag', 'fa-theater-masks', 'fa-thumbtack',
    'fa-torii-gate', 'fa-tree', 'fa-tshirt', 'fa-turkey', 'fa-umbrella-beach', 'fa-unlock', 'fa-up-to-dotted-line',
    'fa-vial', 'fa-wallet', 'fa-wand-magic-sparkles', 'fa-water', 'fa-wave-pulse', 'fa-wheelchair',
    'fa-window-minimize', 'mdi-eye', 'nai-sakura', 'nai-sparkles', 'ri-pencil-ai-2-fill', 'xai-icon'
];

function wrap(text, width) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? line + ' ' + word : word;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function build() {
    const seen = new Map();
    const glyphs = [];
    for (const [url, , list] of MAP) {
        for (const g of list) {
            if (seen.has(g)) throw new Error(`${g} is in ${seen.get(g)} and ${url}`);
            seen.set(g, url);
            glyphs.push(g);
        }
    }
    for (const g of NO_VISTA) if (seen.has(g)) throw new Error(`${g} is mapped and in NO_VISTA`);
    const overGlyphs = [...new Set(OVERRIDES.filter(([, g, url]) => url && g !== '*').map(([, g]) => g))].sort();
    const lst = glyphs.map((g) => '.' + g).join(', ');
    for (const g of MENU_ROW_GLYPHS) if (!seen.has(g)) throw new Error(`${g} is in MENU_ROW_GLYPHS but not mapped`);
    const rowList = [...MENU_ROW_GLYPHS].map((g) => '.' + g).join(', ');
    const ICON_FONT = ':is([class*="fa-"], [class*="nai-"], [class*="mdi-"], [class*="ri-"], .xai-icon)';
    const glyphSel = (g) => (g === '*' ? `i:first-child${ICON_FONT}` : `i.${g}`);
    const olist = overGlyphs.map((g) => '.' + g).join(', ');

    const MENU = 'body.desktop-mode :is(.context-menu, .context-menu-submenu)';
    const BAR = ':is(.explorer-actions-header, .naxt-command-bar, .director-window-command-bar, .gx-commandbar, .studio-change-command-bar)';
    // the light-window scope and the :is() on the button outweigh vista-glass-controls.css hiding a
    // .vista-text-button's glyph
    const CMD = `body.desktop-mode:not(.windows-classic-theme) :is(.modal[data-window-client="light"], .modal[data-vista-dialog]) ${BAR} button:is(.vista-text-button, :not(.vista-text-button))`;
    // the Studio scrub rows' - / + pair stays a matching pair of glyphs
    const MENU_I = `${MENU} i:not(.context-menu-submenu-arrow, .dataset-bias-controls i)`;
    const PICTURED = OVERRIDES.filter(([, , url]) => url);
    const OVR = PICTURED.map(([sel, g]) => `${MENU} .context-menu-item${sel} > ${glyphSel(g)}`);

    const L = [];
    const w = (s) => L.push(s);
    w('/* Vista art instead of Font Awesome in context menus and command bars (.cursor/rules/vista-icons-not-fa.mdc).');
    w('   Generated by scripts/generate-vista-fa-icons.js (edit its tables, not this file): every glyph class');
    w('   below paints its Vista picture on the <i> the menu or command builds, so no menu definition');
    w('   changes. Sources: Explorer\'s Organize menu (shell32), imageres, the shell\'s legacy toolbar strips');
    w('   (shell32 IDB_TB_SH / IDB_TB_IE), Windows Mail\'s toolbar (msoeres.dll bitmap 40), the Services');
    w('   console (filemgmt.dll bitmap 225), Windows Calendar, and a program\'s own caption image where the');
    w('   command opens that program. Items that share a glyph are told apart by data-menu-text');
    w('   (contextMenu.js). Menu rows are mostly text, as in Vista: only Organize-menu commands and rows that');
    w('   open a program keep a picture; the art still shows on icon-only buttons. Glyphs with no Vista');
    w('   counterpart are listed at the end. Context menus in both themes (Vista keeps its icons under');
    w('   Windows Classic); command bars in Aero / Vista Basic. */');
    w('');
    w('/* ---- context menus ---- */');
    w('');
    w(`${MENU_I}:is(${lst}),`);
    w(OVR.join(',\n') + ' {');
    w('    display: inline-block;');
    w('    height: 16px;');
    w('    min-width: 16px;');
    w('    background: transparent no-repeat center / 16px 16px;');
    w('    -webkit-mask: none;');
    w('    mask: none;');
    w('    color: transparent;');
    w('    font-size: 0;');
    w('    text-shadow: none;');
    w('}');
    w('');
    w(`${MENU_I}:is(${lst})::before,`);
    w(OVR.map((o) => o + '::before').join(',\n') + ' {');
    w('    content: none;');
    w('}');
    w('');
    w('/* a disabled command greys its picture, like Vista\'s menus */');
    w(`${MENU} :is(.context-menu-item, .context-menu-icon-btn, .context-menu-grid-btn):is(.disabled, [aria-disabled="true"]) > i:not(.context-menu-submenu-arrow):is(${lst}, ${olist}) {`);
    w('    filter: grayscale(1);');
    w('    opacity: 0.45;');
    w('}');
    w('');
    w('/* Not every row needs an icon: Vista\'s menus are mostly text. A row keeps a picture only for an');
    w('   Organize-menu command or a row that opens a program; any other glyph stays hidden in the gutter so');
    w('   the labels keep their column. (Icon rows and grids are icon-only buttons and keep their art.) */');
    w(`:where(${MENU} .context-menu-item) > i:first-child:where([class*="fa-"], [class*="nai-"], [class*="mdi-"], [class*="ri-"], .xai-icon):not(.context-menu-submenu-arrow, ${rowList}) {`);
    w('    visibility: hidden;');
    w('}');
    w('');
    w('/* Studio\'s dataset, preset, toggle and scrub rows draw their glyph inside the row, right of the');
    w('   gutter: on the desktop they read as words, the label in the text column like every other row */');
    w(`${MENU} .context-menu-item .dataset-option-left > i:not(.dataset-check-icon) {`);
    w('    display: none;');
    w('}');
    w('');
    w('/* a shared-glyph item with its own picture shows it (a checked row still hides it under the mark) */');
    w(PICTURED.map(([sel, g]) => `${MENU} .context-menu-item${sel}:not(.has-menu-mark) > ${glyphSel(g)}`).join(',\n') + ' {');
    w('    visibility: visible;');
    w('}');
    w('');
    w('/* shared-glyph items that read as words */');
    w(OVERRIDES.filter(([, , url]) => !url).map(([sel, g]) => `${MENU} .context-menu-item${sel} > ${glyphSel(g)}`).join(',\n') + ' {');
    w('    visibility: hidden;');
    w('}');
    w('');
    w('/* the submenu arrow: aero.msstyles MENU / POPUPSUBMENU (normal, disabled), 11 px inside the');
    w('   menu\'s right border like the VM\'s menus */');
    w(`${MENU} .context-menu-item > .context-menu-submenu-arrow {`);
    w('    flex: none;');
    w('    width: 4px;');
    w('    height: 7px;');
    w('    margin-right: -3px;');
    w(`    background: url("${CTL}menu-submenu.png") no-repeat center / 4px 7px;`);
    w('    -webkit-mask: none;');
    w('    mask: none;');
    w('    color: transparent;');
    w('    font-size: 0;');
    w('    opacity: 1;');
    w('    filter: none;');
    w('}');
    w('');
    w(`${MENU} .context-menu-item > .context-menu-submenu-arrow::before {`);
    w('    content: none;');
    w('}');
    w('');
    w(`${MENU} .context-menu-item:is(.disabled, [aria-disabled="true"]) > .context-menu-submenu-arrow {`);
    w(`    background-image: url("${CTL}menu-submenu-disabled.png");`);
    w('}');
    w('');
    w('/* Windows Classic draws the arrow in the highlight text colour on a hot row */');
    w('body.desktop-mode.windows-classic-theme :is(.context-menu, .context-menu-submenu) .context-menu-item:is(:hover:not(.disabled), .keyboard-selected, .context-menu-item-highlighted:not(.disabled)) > .context-menu-submenu-arrow {');
    w('    filter: brightness(0) invert(1);');
    w('}');
    w('');
    w('/* ---- command bars ---- */');
    w('');
    w(`${CMD} > i:is(${lst}) {`);
    w('    display: block;');
    w('    flex: none;');
    w('    width: 16px;');
    w('    height: 16px;');
    w('    background: transparent no-repeat center / 16px 16px;');
    w('    -webkit-mask: none;');
    w('    mask: none;');
    w('    color: transparent;');
    w('    font-size: 0;');
    w('    text-shadow: none;');
    w('}');
    w('');
    w(`${CMD} > i:is(${lst})::before {`);
    w('    content: none;');
    w('}');
    w('');
    w(`${CMD}:disabled > i:is(${lst}) {`);
    w('    filter: grayscale(1);');
    w('    opacity: 0.5;');
    w('}');
    w('');
    w('/* ---- the pictures ---- */');
    w('');
    for (const [url, note, list] of MAP) {
        const sel = list.map((g) => '.' + g).join(', ');
        w(`/* ${note} */`);
        w(`${MENU_I}:is(${sel}),`);
        w(`${CMD} > i:is(${sel}) {`);
        w(`    background-image: url("${url}");`);
        w('}');
        w('');
    }
    w('/* ---- command buttons with their own picture ---- */');
    w('');
    for (const [sel, url, why] of BUTTON_OVERRIDES) {
        w(`/* ${why} */`);
        w(`body.desktop-mode:not(.windows-classic-theme) ${sel} > i {`);
        w(`    background-image: url("${url}");`);
        w('}');
        w('');
    }
    w('/* ---- items that share a glyph ---- */');
    w('');
    PICTURED.forEach(([, , url], n) => {
        w(`${OVR[n]} {`);
        w(`    background-image: url("${url}");`);
        w('    background-size: 16px 16px;');
        w('}');
        w('');
    });
    const note = 'No Vista counterpart (apart from the shared-glyph items above): text only in a menu row, Font Awesome '
        + 'on an icon-only button: '
        + NO_VISTA.join(', ') + '.';
    w('/* ' + wrap(note, 100).join('\n   ') + ' */');
    return { css: L.join('\n') + '\n', glyphs: glyphs.length };
}

if (require.main === module) {
    const out = path.join(__dirname, '..', 'public', 'css', 'vista-fa-icons.css');
    const { css, glyphs } = build();
    fs.writeFileSync(out, css);
    console.log(`${path.relative(process.cwd(), out)}: ${glyphs} glyphs, ${MAP.length} pictures, ${OVERRIDES.length} shared-glyph items`);
}

module.exports = { MAP, OVERRIDES, BUTTON_OVERRIDES, NO_VISTA, build };
