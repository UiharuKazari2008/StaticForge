/**
 * Melaton Mobile: DreamStudio part - Stages (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelStages.js adds what it needs).
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Stages', (api, reg) => { /* filled in by the part's work */ });
})();
