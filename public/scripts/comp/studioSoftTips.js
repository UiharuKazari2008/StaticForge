// Studio soft-warn tips from Apocrypha Friday desk (Yozora #146).
// Cheap UX toasts — not a redesign. Relies on globals from manualDropdownManager.js
// (appendQuality, appendTransparency) and showGlassToast from toastManager.js.

const STUDIO_SOFT_TIP_COOLDOWN_MS = 8 * 60 * 1000;
const studioSoftTipLastShown = Object.create(null);
let studioSoftTipsTimer = null;
let studioSoftTipsBound = false;

const STUDIO_SOFT_TIP_QUALITY_RE = /\b(best quality|masterpiece|very aesthetic|absurdres|newest)\b/i;
const STUDIO_SOFT_TIP_HEAVY_EMPHASIS_RE = /(?:^|[\s,])2(?:\.\d+)?::[^:]{0,80}::/;
const STUDIO_SOFT_TIP_LOWER_TEXT_RE = /(?:^|[\s,{[])text\s*:/;
const STUDIO_SOFT_TIP_SCENE_RE = /\b(background|scenery|outdoors|indoors|landscape|cityscape|bedroom|classroom|beach|forest|street|skyline|interior|exterior)\b/i;
const STUDIO_SOFT_TIP_UC_CHAR_RE = /\b[a-z0-9][a-z0-9 _.-]{1,40}\s*\([^)]{2,40}\)/i;

function studioSoftTipMayShow(id) {
    const last = studioSoftTipLastShown[id] || 0;
    return (Date.now() - last) >= STUDIO_SOFT_TIP_COOLDOWN_MS;
}

function studioSoftTipShow(id, title, message) {
    if (!studioSoftTipMayShow(id)) return;
    // showGlassToast: public/scripts/comp/toastManager.js
    if (typeof showGlassToast !== 'function') return;
    studioSoftTipLastShown[id] = Date.now();
    showGlassToast('info', title, message, false, 6000, '<i class="fas fa-info-circle"></i>');
}

function studioSoftTipsReadPrompt() {
    const el = document.getElementById('manualPrompt');
    return el && typeof el.value === 'string' ? el.value : '';
}

function studioSoftTipsReadUc() {
    const el = document.getElementById('manualUc');
    return el && typeof el.value === 'string' ? el.value : '';
}

function studioSoftTipsQualityOn() {
    // appendQuality: public/scripts/comp/manualDropdownManager.js
    return typeof appendQuality !== 'undefined' ? !!appendQuality : true;
}

function studioSoftTipsTransparencyOn() {
    // appendTransparency: public/scripts/comp/manualDropdownManager.js
    return typeof appendTransparency !== 'undefined' ? !!appendTransparency : false;
}

function evaluateStudioSoftTips() {
    const prompt = studioSoftTipsReadPrompt();
    const uc = studioSoftTipsReadUc();

    if (studioSoftTipsQualityOn() && (STUDIO_SOFT_TIP_QUALITY_RE.test(prompt) || STUDIO_SOFT_TIP_HEAVY_EMPHASIS_RE.test(prompt))) {
        studioSoftTipShow(
            'qt-stack',
            'Quality toggle',
            'QT is on — it already injects the aesthetic / masterpiece stack. Pasted best quality / heavy 2:: quality blocks usually stack on top of that.'
        );
    }

    if (STUDIO_SOFT_TIP_LOWER_TEXT_RE.test(prompt)) {
        studioSoftTipShow(
            'text-case',
            'Speech text',
            'Prefer capital Text: (or prose) for speech bubbles. Lowercase text: is the weaker path.'
        );
    }

    if (studioSoftTipsTransparencyOn() && STUDIO_SOFT_TIP_SCENE_RE.test(prompt)) {
        studioSoftTipShow(
            'transparent-scene',
            'Transparent BG',
            'Transparency is on with scene / background tags — that path biases toward negative space. Fine for cutouts; odd for full scenes.'
        );
    }

    if (uc && STUDIO_SOFT_TIP_UC_CHAR_RE.test(uc)) {
        studioSoftTipShow(
            'uc-franchise',
            'UC hygiene',
            'UC still has character (franchise) tags. Leftovers from another series can fight copyright style — clear stale names when you switch.'
        );
    }
}

function scheduleStudioSoftTips() {
    if (studioSoftTipsTimer) clearTimeout(studioSoftTipsTimer);
    studioSoftTipsTimer = setTimeout(() => {
        studioSoftTipsTimer = null;
        evaluateStudioSoftTips();
    }, 700);
}

function notifyStudioSoftTipsDatasetChange() {
    scheduleStudioSoftTips();
}

function attachStudioSoftTipsListeners(signal) {
    const prompt = document.getElementById('manualPrompt');
    const uc = document.getElementById('manualUc');
    if (prompt) {
        prompt.addEventListener('input', scheduleStudioSoftTips, { signal });
        prompt.addEventListener('blur', scheduleStudioSoftTips, { signal });
    }
    if (uc) {
        uc.addEventListener('input', scheduleStudioSoftTips, { signal });
        uc.addEventListener('blur', scheduleStudioSoftTips, { signal });
    }
}

function initStudioSoftTips() {
    if (studioSoftTipsBound) return;
    const manualModalEl = document.getElementById('manualModal');
    if (!manualModalEl) return;
    studioSoftTipsBound = true;
    // attachModalListeners: public/scripts/comp/modalListenerScope.js
    attachModalListeners(manualModalEl, attachStudioSoftTipsListeners);
}

if (typeof wsClient !== 'undefined' && wsClient) {
    wsClient.registerInitStep(475, 'Studio soft tips', async () => {
        initStudioSoftTips();
    });
}
