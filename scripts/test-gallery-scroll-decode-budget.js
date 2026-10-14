#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'scripts', 'comp', 'galleryView.js'),
    'utf8'
);
const galleryCss = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'gallery-core.css'),
    'utf8'
);
const galleryLoadSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'scripts', 'comp', 'galleryImagesLoad.js'),
    'utf8'
);

function extractFunction(header) {
    const start = source.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

assert.match(
    source,
    /let maxTotalConcurrent = 4;\s*\/\/ Keep preview decode from saturating the client/,
    'gallery preview decode concurrency stays bounded'
);
assert.match(
    source,
    /multiplexingLevel = Math\.max\(1, Math\.min\(maxTotalConcurrent, multiplexingLevel\)\);/,
    'RTT multiplexing cannot exceed the decode budget or stall at zero'
);

const watcher = extractFunction('function processNextPlaceholders()');
const scrollPauseStart = watcher.indexOf('if (isScrolling) {');
const queueWorkStart = watcher.indexOf('// Track queue growth');
assert.ok(scrollPauseStart >= 0 && queueWorkStart > scrollPauseStart, 'watcher pauses before queue work');
const scrollPause = watcher.slice(scrollPauseStart, queueWorkStart);
assert.match(scrollPause, /placeholderWatcherFrameId = null;/);
assert.ok(!scrollPause.includes('setTimeout'), 'paused watcher does not keep waking while scrolling');
assert.ok(!scrollPause.includes('addImgToGalleryItemAsync'), 'scroll pause does not start image decode');

const virtualScroll = extractFunction('function updateVirtualScrollInternal()');
assert.match(
    virtualScroll,
    /const immediateVisibleResolveBudget = galleryIdle \? 2 : 0;/,
    'active scrolling has no direct decode budget'
);

const stopGate = virtualScroll.indexOf('// Scrolling keeps the existing static cells.');
const forceResolve = virtualScroll.indexOf('// --- Force resolve all placeholders');
assert.ok(stopGate >= 0 && forceResolve > stopGate, 'scrolling exits before the second DOM measurement');
assert.match(virtualScroll.slice(stopGate, forceResolve), /if \(isScrolling\)[\s\S]*return;/);

const boundedResolve = virtualScroll.slice(
    forceResolve,
    virtualScroll.indexOf('// With sentinel-based approach', forceResolve)
);
assert.match(boundedResolve, /queuePlaceholderResolution\(el, fileIndex, filteredIndex\)/);
assert.ok(!boundedResolve.includes('addImgToGalleryItemAsync'), 'stop pass uses the bounded resolver');

const blurhashSchedule = extractFunction('function scheduleGalleryItemBlurhash(');
assert.match(blurhashSchedule, /if \(isScrolling\) return;/);
const blurhashFlush = extractFunction('function flushGalleryBlurhashPaintQueue()');
assert.match(
    blurhashFlush,
    /if \(isScrolling\)\s*\{\s*galleryBlurhashPaintQueue\.length = 0;\s*return;/,
    'scrolling drops optional BlurHash canvas work'
);

const infiniteScroll = extractFunction('function handleInfiniteScroll()');
assert.match(
    infiniteScroll,
    /if \(isLoadingMore \|\| isScrolling\) return;/,
    'active scrolling never mutates the virtual gallery'
);

const observerInit = extractFunction('function initIntersectionObserver()');
assert.match(
    observerInit,
    /if \(isScrolling \|\| isFastScrolling\) return;/,
    'intersection callbacks do not duplicate layout work while moving'
);
assert.ok(
    !/if \(isScrolling \|\| isFastScrolling\)\s*\{\s*updateVirtualScroll\(\)/.test(observerInit),
    'intersection callbacks never request virtual layout during scrolling'
);

const initStart = source.indexOf("window.wsClient.registerInitStep(30, 'Initializing Gallery System'");
const initEnd = source.indexOf('function isGalleryWindowKeyboardContext', initStart);
assert.ok(initStart >= 0 && initEnd > initStart, 'gallery init scroll handler exists');
const galleryInit = source.slice(initStart, initEnd);
assert.match(
    galleryInit,
    /scrollEndTimeout = setTimeout\(\(\) => \{[\s\S]*scrollVelocity = 0;[\s\S]*handleInfiniteScroll\(\);/,
    'scroll-stop performs one virtual DOM catch-up pass'
);
assert.ok(
    !/const now = Date\.now\(\);[\s\S]*handleInfiniteScroll\(\);[\s\S]*lastScrollTime = now;/.test(galleryInit),
    'scroll frames do not run periodic virtual DOM passes'
);

assert.match(
    source,
    /const scrollEndDelay = isIOS \? 180 : 150;/,
    'scroll stop waits long enough to avoid class and decode flapping between wheel events'
);
assert.match(
    galleryCss,
    /\.gallery\.is-scrolling \.gallery-item,\s*\.gallery\.is-scrolling \.gallery-placeholder,\s*\.gallery\.is-scrolling \.gallery-item img,\s*\.gallery\.is-scrolling \.gallery-item-overlay\s*\{\s*transition:\s*none;/,
    'scrolling disables descendant image and overlay transitions'
);
assert.ok(
    !/\.gallery-item\s*\{[^}]*content-visibility:\s*auto/s.test(galleryCss),
    'virtualized gallery cells do not run a second browser visibility engine'
);
assert.ok(
    !/\.gallery\.is-scrolling\s*\{[^}]*contain:\s*layout/s.test(galleryCss),
    'scrolling never changes gallery layout containment or scroll geometry'
);
assert.match(
    galleryCss,
    /\.gallery-item\s*\{[^}]*contain:\s*paint;/s,
    'gallery cell paint stays locally contained'
);
assert.match(
    galleryCss,
    /\.gallery\.is-scrolling \.gallery-item\s*\{\s*pointer-events:\s*none;/,
    'moving tiles cannot churn hover paint beneath a stationary pointer'
);
assert.match(
    galleryCss,
    /\.gallery\.is-scrolling \.gallery-item-overlay\s*\{[^}]*visibility:\s*hidden;[^}]*box-shadow:\s*none;/s,
    'hidden action overlays do not paint while scrolling'
);
for (const field of ['activeResolutions', 'blurhashQueue', 'scrolling', 'watcherRunning']) {
    assert.match(galleryLoadSource, new RegExp(`\\b${field}\\b`), `telemetry includes ${field}`);
}
assert.match(
    galleryLoadSource,
    /async function yieldGalleryProgressPaint\(\)[\s\S]*while \(isScrolling \|\| isGalleryWindowHidden\(\)\)[\s\S]*setTimeout\(resolve, 150\)/,
    'full gallery block sync pauses while scrolling or closed'
);

console.log('test-gallery-scroll-decode-budget: ok');
