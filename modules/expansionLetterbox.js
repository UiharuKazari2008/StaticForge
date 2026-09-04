/**
 * Pixel placement for expand-canvas letterbox.
 * Client mirror: computeExpansionLetterboxLayout in public/scripts/comp/utilities.js
 */
function computeExpansionLetterboxLayout(origWidth, origHeight, targetWidth, targetHeight, bias = 2, options = {}) {
    const origW = parseInt(origWidth, 10) || 0;
    const origH = parseInt(origHeight, 10) || 0;
    const targetW = parseInt(targetWidth, 10) || 0;
    const targetH = parseInt(targetHeight, 10) || 0;
    if (origW < 1 || origH < 1 || targetW < 1 || targetH < 1) {
        return null;
    }

    const origAR = origW / origH;
    const targetAR = targetW / targetH;
    const insetEnabled = options && (options.inset === true || options.inset === 'true' || options.inset === 1);
    const targetIsLargerThanSource = targetW > origW && targetH > origH;

    let scaledWidth;
    let scaledHeight;
    if (insetEnabled && targetIsLargerThanSource) {
        scaledWidth = origW;
        scaledHeight = origH;
    } else if (origAR > targetAR) {
        scaledWidth = targetW;
        scaledHeight = Math.round(targetW / origAR);
    } else {
        scaledHeight = targetH;
        scaledWidth = Math.round(targetH * origAR);
    }

    const biasFractions = [0, 0.25, 0.5, 0.75, 1];
    const biasIndex = parseInt(bias, 10);
    const biasFrac = biasFractions[biasIndex] !== undefined ? biasFractions[biasIndex] : 0.5;
    const padX = targetW - scaledWidth;
    const padY = targetH - scaledHeight;

    let left;
    let top;
    if (insetEnabled && padX > 0 && padY > 0) {
        const isPortraitSource = origH > origW;
        if (isPortraitSource) {
            left = Math.round(padX * 0.5);
            top = Math.round(padY * biasFrac);
        } else {
            left = Math.round(padX * biasFrac);
            top = Math.round(padY * 0.5);
        }
    } else if (origAR > targetAR) {
        left = 0;
        top = Math.round(padY * biasFrac);
    } else {
        left = Math.round(padX * biasFrac);
        top = 0;
    }

    return {
        origWidth: origW,
        origHeight: origH,
        targetWidth: targetW,
        targetHeight: targetH,
        scaledWidth,
        scaledHeight,
        left,
        top,
        padLeft: left,
        padRight: targetW - scaledWidth - left,
        padTop: top,
        padBottom: targetH - scaledHeight - top
    };
}

module.exports = {
    computeExpansionLetterboxLayout
};
