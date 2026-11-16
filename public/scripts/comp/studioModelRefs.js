/**
 * studioModel part - Refs (#860 migration): the Studio calls DreamStudio's Refs part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;
    M.extend({});
})();
