/**
 * Melaton Mobile Settings: System pages (Clock & Alarms, Regional Settings, Power, Backlight, Melaton Update, Remove Programs, About) (Yozora #709).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth).
 * Styles: public/css/wm-settings-system.css. Runs only on Melaton Mobile (uiShell 'mobile').
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;

    // pages are added here (Yozora #709, Settings pages for the desktop Control Panel)
})();
