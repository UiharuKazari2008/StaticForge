'use strict';

/**
 * The test lane's Traffic (StaticForge #1289): what the test devices (modules/testDevices.js: the Android emulator)
 * reported with traffic_place, and the scheduled To Home / To Work run for that lane alone. Admin only. Nothing here
 * reaches a real phone or the household's pages: a test device's place is kept in the test lane of
 * modules/trafficService.js and the lane's notice is published to test devices only.
 *
 *   GET    /api/test-devices/traffic             { places: { primary, devices, log }, decision: { home, work } }: the places
 *                                                  the test devices reported (their own lane, never the household's) and
 *                                                  what a test-lane run would do for each direction
 *   POST   /api/test-devices/traffic/run         { direction: 'home'|'work', kind?: 'scheduled'|'go' } -> { result }: the
 *                                                  scheduled To Home / To Work run for the test lane (trafficService
 *                                                  runScheduled, lane 'test'): decided from the test lane's reports,
 *                                                  published into the test lane, nothing to the household's pages
 *   DELETE /api/test-devices/traffic             clear the test lane's reported places and log
 *
 * Mounted before modules/testDevicesRoute.js (web_server.js): its '/api/test-devices/:id' would take 'traffic' for a
 * device id.
 */

const testDevices = require('./testDevices');

function mount(app, authMiddleware) {
    const auth = authMiddleware || ((req, res, next) => next());
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };
    const admin = (req, res, next) => (req.userType === 'admin' ? next() : refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required.'));

    app.get('/api/test-devices/traffic', auth, admin, (req, res) => {
        const traffic = require('./trafficService');
        const now = Date.now();
        const lane = { lane: 'test' };
        res.json({ success: true, places: traffic.phonePlaces(now, lane), decision: { home: traffic.phoneDecision('home', now, lane), work: traffic.phoneDecision('work', now, lane) } });
    });

    app.post('/api/test-devices/traffic/run', auth, admin, async (req, res) => {
        if (!testDevices.list().length) { refuse(res, 409, 'NO_TEST_DEVICE', 'No test device is set.'); return; }
        const b = req.body || {};
        const direction = b.direction;
        const kind = b.kind === undefined ? 'scheduled' : b.kind;
        if (direction !== 'home' && direction !== 'work') { refuse(res, 400, 'BAD_REQUEST', "direction must be 'home' or 'work'."); return; }
        if (kind !== 'scheduled' && kind !== 'go') { refuse(res, 400, 'BAD_REQUEST', "kind must be 'scheduled' or 'go'."); return; }
        try {
            res.json({ success: true, result: await require('./trafficService').runScheduled(direction, kind, { lane: 'test' }) });
        } catch (e) {
            refuse(res, 500, 'TRAFFIC_RUN_FAILED', e.message);
        }
    });

    app.delete('/api/test-devices/traffic', auth, admin, (req, res) => {
        res.json({ success: require('./trafficService').clearPhoneLane('test') });
    });
}

module.exports = { mount };
