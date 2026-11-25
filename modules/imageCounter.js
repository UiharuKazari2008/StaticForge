const fs = require('fs');
const path = require('path');
const imageStore = require('./imageStore');
const pictureIds = require('./pictureIds');

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

let counterFile = null;
let imageDir = null;
let timestamps = [];
let initialized = false;

function initializeImageCounter(globalResources) {
    if (!globalResources) {
        throw new Error('initializeImageCounter requires globalResources');
    }
    counterFile = globalResources.getPath('imageCounterFile');
    imageDir = globalResources.getPath('images');
    initialized = true;
    loadCounter();
}

async function pruneOld(now = Date.now()) {
    timestamps = timestamps.filter(ts => now - ts < ROLLING_WINDOW_MS);
}

function saveCounter() {
    try {
        fs.writeFileSync(counterFile, JSON.stringify(timestamps), 'utf-8');
    } catch (e) {
        console.error('Failed to save image counter:', e);
    }
}

function loadCounter() {
    if (!initialized || !counterFile) return;
    if (fs.existsSync(counterFile)) {
        try {
            const data = fs.readFileSync(counterFile, 'utf-8');
            timestamps = JSON.parse(data);
            pruneOld();
        } catch (e) {
            console.error('Failed to load image counter:', e);
            timestamps = [];
        }
    } else {
        // Fallback: scan images dir for recent images
        try {
            const now = Date.now();
            // x.jxl counts as its picture x.png, once
            const files = imageStore.logicalNames(fs.readdirSync(imageDir));
            timestamps = files
                .map(f => {
                    // a picture ID encodes its time (#1156); legacy names start with it in ms
                    const idMs = pictureIds.timeOf(f);
                    if (idMs !== null) return idMs;
                    const match = f.match(/^(\d+)_/);
                    return match ? parseInt(match[1], 10) : null;
                })
                .filter(ts => ts && now - ts < ROLLING_WINDOW_MS);
        } catch (e) {
            timestamps = [];
        }
    }
}

function logGeneration(ts = Date.now()) {
    pruneOld(ts);
    timestamps.push(ts);
    saveCounter();
}

function getCount() {
    pruneOld();
    return timestamps.length;
}

function getTimestamps() {
    pruneOld();
    return [...timestamps];
}

module.exports = {
    initializeImageCounter,
    logGeneration,
    getCount,
    getTimestamps,
    loadCounter,
}; 