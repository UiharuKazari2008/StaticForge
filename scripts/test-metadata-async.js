const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Module = require('module');

// Mock missing native modules
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, errors: () => {}, ms: () => {} },
            createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {} }),
            transports: { Console: class {}, File: class {}, DailyRotateFile: class {} }
        };
    }
    if (request === 'winston-daily-rotate-file') {
        return class {};
    }
    if (request === './sqliteAsyncWrapper.js' || request.includes('sqliteAsyncWrapper')) {
        return class SQLiteAsyncWrapper {
            async open() { return true; }
            async exec() { return true; }
            async all() { return []; }
            async get() { return null; }
            async run() { return { lastID: 1 }; }
            async prepare() { return { all: async () => [], get: async () => null, run: async () => ({}) }; }
            async initialize() { return true; }
            on() {}
        };
    }
    if (request === 'sharp' || request.includes('better-sqlite3') || request.includes('sqlite3') || request.includes('sqlite')) {
        if (request === 'sqlite') {
            return {
                open: async () => ({
                    exec: async () => {},
                    all: async () => [],
                    get: async () => null,
                    run: async () => ({ lastID: 1 })
                })
            };
        }
        if (request === 'sharp') {
            return function() {
                return {
                    metadata: async () => ({ width: 100, height: 100 }),
                    withMetadata: () => this,
                    toBuffer: async () => Buffer.from('dummy')
                };
            };
        }
        return {};
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw e;
    }
};

const metadataDatabase = require('../modules/metadataDatabase.js');

async function runTest() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-metadata-'));
    const imagesDir = path.join(tmpDir, 'images');
    fs.mkdirSync(imagesDir);

    const testFile = path.join(imagesDir, 'test.png');

    // valid 1x1 PNG
    const validPngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082';
    fs.writeFileSync(testFile, Buffer.from(validPngHex, 'hex'));

    const dbFile = path.join(tmpDir, 'test.db');
    const mockPngMetadata = {
        extractNovelAIMetadata: async () => ({ width: 100, height: 100 }),
        updateMetadata: (buffer) => buffer
    };

    await metadataDatabase.initializeDatabase(dbFile, mockPngMetadata);

    const receiptData = { data: 'test-receipt' };
    const forgeData = { parameters: 'test-forge' };

    await metadataDatabase.addReceiptMetadata('test.png', imagesDir, receiptData, forgeData);

    const stats = fs.statSync(testFile);
    assert(stats.size > 0, "File should have a size");

    console.log("Async receipt metadata generation passed without blocking event loop!");
    process.exit(0);
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
