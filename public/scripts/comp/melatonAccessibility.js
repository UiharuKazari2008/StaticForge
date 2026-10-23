/**
 * Ease of Access settings that change the desktop (Yozora #632; Control Panel > Ease of Access
 * Center, cplPages2.js): read from Melaton's registry at load and on every change, so they hold
 * from logon on as Vista's do.
 *
 *   HighContrast      html[data-access-high-contrast]  (public/css/melaton-accessibility.css)
 *   ThickFocus        html[data-access-thick-focus]
 *   NoAnimations      html[data-access-no-animations]
 *   UnderlineAccess   html[data-access-underline-keys] (access-key <u> always shown)
 *   Narrator          speaks the focused control's name with the browser's speech
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Accessibility';
    let narratorOff = null;

    function on(name) {
        const reg = root.melatonRegistry;
        return !!reg && reg.get(KEY, name, false) === true;
    }

    function narrator(enabled) {
        if (narratorOff) { narratorOff(); narratorOff = null; }
        if (!enabled || !doc || !root.speechSynthesis) return;
        const say = (ev) => {
            const el = ev.target;
            if (!el || !el.getAttribute) return;
            const text = el.getAttribute('aria-label') || el.title || (el.labels && el.labels[0] && el.labels[0].textContent) || el.textContent || el.value || '';
            const t = String(text).trim().slice(0, 200);
            if (!t) return;
            root.speechSynthesis.cancel();
            root.speechSynthesis.speak(new root.SpeechSynthesisUtterance(t));
        };
        doc.addEventListener('focusin', say);
        narratorOff = () => doc.removeEventListener('focusin', say);
    }

    function apply() {
        if (!doc) return;
        const html = doc.documentElement;
        html.toggleAttribute('data-access-high-contrast', on('HighContrast'));
        html.toggleAttribute('data-access-thick-focus', on('ThickFocus'));
        html.toggleAttribute('data-access-no-animations', on('NoAnimations'));
        html.toggleAttribute('data-access-underline-keys', on('UnderlineAccess'));
        narrator(on('Narrator'));
    }

    root.melatonAccessibility = { KEY, apply };
    if (root.melatonRegistry) root.melatonRegistry.onChange((key) => { if (key === null || key === KEY) apply(); });
    apply();
})(typeof window !== 'undefined' ? window : globalThis);
