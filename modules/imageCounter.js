const fs = require('fs');
const path = require('path');

const COUNTER_FILE = path.resolve(__dirname, '../.cache/image_counter.json');
const IMAGE_DIR = path.resolve(__dirname, '../images');
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

let timestamps = [];

async function pruneOld(now = Date.now()) {
    timestamps = timestamps.filter(ts => now - ts < ROLLING_WINDOW_MS);
}

function saveCounter() {
    try {
        fs.writeFileSync(COUNTER_FILE, JSON.stringify(timestamps), 'utf-8');
    } catch (e) {
        console.error('Failed to save image counter:', e);
    }
}

function loadCounter() {
    if (fs.existsSync(COUNTER_FILE)) {
        try {
            const data = fs.readFileSync(COUNTER_FILE, 'utf-8');
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
            const files = fs.readdirSync(IMAGE_DIR);
            timestamps = files
                .map(f => {
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

// Load on startup
loadCounter();

module.exports = {
    logGeneration,
    getCount,
    getTimestamps,
    loadCounter,
}; 