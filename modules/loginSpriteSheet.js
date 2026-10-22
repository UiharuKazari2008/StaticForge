'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PLACEHOLDER_SIZE = 1;

/**
 * When the site cover gate is on, the PIN login page is not shown; keep /.login.jpg
 * valid with a tiny black JPEG instead of the gallery composite sheet.
 */
async function writeGatePlaceholderSprite(spritePath) {
    if (!spritePath) return;
    const dir = path.dirname(spritePath);
    fs.mkdirSync(dir, { recursive: true });
    await sharp({
        create: {
            width: PLACEHOLDER_SIZE,
            height: PLACEHOLDER_SIZE,
            channels: 3,
            background: { r: 0, g: 0, b: 0 }
        }
    })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(spritePath);
}

function isGatePlaceholderFile(spritePath) {
    try {
        const st = fs.statSync(spritePath);
        return st.isFile() && st.size > 0 && st.size <= 512;
    } catch (_err) {
        return false;
    }
}

module.exports = {
    writeGatePlaceholderSprite,
    isGatePlaceholderFile,
    PLACEHOLDER_SIZE
};
