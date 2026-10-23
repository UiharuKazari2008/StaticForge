// JULES: Regression test for dynamicGenerationHandlers.timeCalc dead code cleanup
const assert = require('assert');
const Module = require('module');

// Override Module._load to handle missing native/external modules in sandbox if needed
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND' && request === 'sunrise-sunset-js') {
            return {
                getSunrise: (lat, lon, date) => new Date(date.getTime() - 6 * 3600 * 1000),
                getSunset: (lat, lon, date) => new Date(date.getTime() + 6 * 3600 * 1000)
            };
        }
        if (err.code === 'MODULE_NOT_FOUND' && request === 'winston') {
            return {
                format: {
                    combine: () => {},
                    timestamp: () => {},
                    printf: () => {},
                    colorize: () => {}
                },
                transports: {
                    Console: class {},
                    File: class {}
                },
                createLogger: () => ({
                    info: () => {},
                    warn: () => {},
                    error: () => {},
                    detailed: () => {}
                })
            };
        }
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

const { determineTimePeriod, getSunriseSunset } = require('../modules/dynamicGenerationHandlers.timeCalc');

async function runTests() {
    console.log('Testing getSunriseSunset...');
    const location = { lat: 37.7749, lon: -122.4194, timezone: 'America/Los_Angeles' };
    const date = new Date('2025-06-21T12:00:00Z');
    const sunData = await getSunriseSunset(location, date);

    assert.strictEqual(typeof sunData.sunrise, 'number');
    assert.strictEqual(typeof sunData.sunset, 'number');
    assert.strictEqual(typeof sunData.sunriseHour, 'number');
    assert.strictEqual(typeof sunData.sunsetHour, 'number');
    assert.strictEqual(sunData.isPolarDay, false);
    assert.strictEqual(sunData.isPolarNight, false);
    console.log('getSunriseSunset OK:', sunData.sunriseHour.toFixed(2), 'am to', sunData.sunsetHour.toFixed(2), 'pm');

    console.log('Testing determineTimePeriod...');
    const timeInput = {
        year: 2025,
        month: 5,
        dayOfMonth: 21,
        hour: 12,
        minute: 0,
        second: 0,
        timestamp: date.getTime()
    };
    const periodResult = await determineTimePeriod(timeInput, 'summer', location, { cloudCoverage: 10, temperature: 22 });

    assert.ok(periodResult.period);
    assert.ok(periodResult.periodKey);
    assert.ok(Array.isArray(periodResult.lighting));
    assert.ok(Array.isArray(periodResult.atmosphere));
    assert.strictEqual(periodResult.season, 'summer');
    console.log('determineTimePeriod OK:', periodResult.period, '(', periodResult.periodKey, ')');

    console.log('All dynamicGenerationHandlers.timeCalc tests passed successfully.');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
