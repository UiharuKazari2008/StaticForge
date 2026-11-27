'use strict';
// What each painted splash frame showed.  node classify.js <run.json> <framedir>
// A frame is a splash frame when the strip with the product words matches the reference (ref-splash-full.png);
// the emblem / badge counts as shown when its box differs from the reference by a mean of under 4 grey levels.
// badgeState: complete (differs from the full reference by under 2.5), absent (differs from the splash without a
// badge, ref-splash-nobadge.png, by under 1.5), otherwise incomplete (a badge box without its whole picture).
const fs = require('fs');
const path = require('path');
const sharp = require('/home/kanmi/staticforge/node_modules/sharp');
const BOX = { words: [136, 78, 186, 100], emblem: [29, 67, 101, 101], cafe: [259, 822, 138, 78] };
async function pixels(src, [left, top, width, height]) {
    return sharp(src).extract({ left, top, width, height }).removeAlpha().greyscale().raw().toBuffer();
}
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
async function classify(jsonPath, dir) {
    const j = JSON.parse(fs.readFileSync(jsonPath));
    const ref = {};
    for (const k of Object.keys(BOX)) ref[k] = await pixels(path.join(__dirname, 'ref-splash-full.png'), BOX[k]);
    const bare = await pixels(path.join(__dirname, 'ref-splash-nobadge.png'), BOX.cafe);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({ f, t: Number(/-(-?\d+)ms\.png$/.exec(f)[1]) })).sort((a, b) => a.t - b.t);
    const frames = [];
    for (const { f, t } of files) {
        // the new tab's first frame can come before the phone's screen size is on
        if ((await sharp(path.join(dir, f)).metadata()).height !== 915) continue;
        const d = {};
        for (const k of Object.keys(BOX)) d[k] = diff(await pixels(path.join(dir, f), BOX[k]), ref[k]);
        if (d.words < 6) {
            const bareDiff = diff(await pixels(path.join(dir, f), BOX.cafe), bare);
            const badgeState = d.cafe < 2.5 ? 'complete' : bareDiff < 1.5 ? 'absent' : 'incomplete';
            frames.push({ t, file: f, emblem: d.emblem < 4, badge: d.cafe < 4, badgeState, emblemDiff: +d.emblem.toFixed(1), badgeDiff: +d.cafe.toFixed(1), badgeVsBare: +bareDiff.toFixed(1) });
        }
    }
    const first = frames[0] || null;
    const full = frames.find((x) => x.emblem && x.badge) || null;
    const res = { splashFrames: frames.length, firstSplashFrameAt: first && first.t, firstFrameEmblem: first && first.emblem, firstFrameBadge: first && first.badge,
        firstFullArtFrameAt: full && full.t, msOnScreenWithArtMissing: first ? (full ? full.t - first.t : null) : null,
        framesWithArtMissing: frames.filter((x) => !(x.emblem && x.badge)).map((x) => ({ t: x.t, emblem: x.emblem, badge: x.badge })),
        firstFrameBadgeState: first && first.badgeState,
        badgeFrames: { complete: frames.filter((x) => x.badgeState === 'complete').length, absent: frames.filter((x) => x.badgeState === 'absent').length, incomplete: frames.filter((x) => x.badgeState === 'incomplete').length },
        frames: frames.map((x) => [x.t, x.emblem ? 1 : 0, x.badgeState, x.badgeDiff, x.badgeVsBare]) };
    j.painted = res;
    delete j.frames;
    fs.writeFileSync(jsonPath, JSON.stringify(j, null, 1));
    return res;
}
module.exports = { classify };
if (require.main === module) classify(process.argv[2], process.argv[3]).then((r) => console.log(JSON.stringify(r)));
