'use strict';

/**
 * Test devices' admin routes (modules/testDevices.js): the Android emulator harness on Ruiko (~/.config/aemu) marks
 * its device, sends it test notices in the test lane and reads back what the phone confirmed. Admin only. Nothing here
 * reaches a real phone: a test notice goes to test devices alone, and every route refuses while no test device is set.
 *
 *   GET    /api/test-devices                     { devices: [{ id, name, markedAt, status, online, partner, service,
 *                                                  pageInFront }], notices: <the test lane, cleared too> }
 *   PUT    /api/test-devices/:id                 { name?, status?, replaceStatus? } mark it (status: snapshot fields set
 *                                                  over the neutral test snapshot, null drops one) -> the device
 *   DELETE /api/test-devices/:id                 unmark (it is a household phone again: unpartner it first)
 *   POST   /api/test-devices/notice              { mode: 'push'|'get', id?, title, text?, cls?, app?, actions?, data?,
 *                                                  ttlMs?, alert? } -> { notice }
 *                                                  push: sent live over the background link (as_event inbox.notice);
 *                                                  get: stored only - the phone fetches it (hello catch-up, the status
 *                                                  snapshot's notices list, POST .../catch-up)
 *   POST   /api/test-devices/notice/:nid/clear   cleared at the server (as_event inbox.cleared to the test devices)
 *   DELETE /api/test-devices/notices             clear the whole test lane
 *   POST   /api/test-devices/:id/catch-up        what a hello would send now (notificationInbox.catchUpPhone)
 *   GET    /api/test-devices/deliveries          ?device= the delivery rows: sentAt, attempts, postedAt, how
 */

const testDevices = require('./testDevices');

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const inbox = () => require('./notificationInbox');
    const as = () => require('./activeSync');
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };
    const admin = (req, res, next) => (req.userType === 'admin' ? next() : refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required.'));
    const touch = () => { try { require('./phoneStatus').touch('test'); } catch (_e) { /* best effort */ } };

    const linkOf = (id) => {
        try {
            const links = as().partnerLinks(globalResources, null) || [];
            const l = links.find((x) => x.deviceId === id);
            return { online: !!l, partner: !!l, service: !!(l && l.service), pageInFront: !!(l && l.foreground) };
        } catch (_e) { return { online: false, partner: false, service: false }; }
    };

    app.get('/api/test-devices', auth, admin, (req, res) => {
        const devices = testDevices.list().map((d) => Object.assign(d, linkOf(d.id)));
        res.json({ success: true, devices, notices: inbox().list('test', { includeCleared: true }) });
    });

    app.put('/api/test-devices/:id', auth, admin, (req, res) => {
        const b = req.body || {};
        const dev = testDevices.mark(req.params.id, { name: b.name });
        if (!dev) { refuse(res, 400, 'BAD_REQUEST', 'Bad device id (32 hex digits).'); return; }
        if (b.status !== undefined) testDevices.setStatusOverrides(dev.id, b.status, { replace: !!b.replaceStatus });
        touch();
        res.json({ success: true, device: Object.assign(testDevices.list().find((d) => d.id === dev.id), linkOf(dev.id)) });
    });

    app.delete('/api/test-devices/:id', auth, admin, (req, res) => {
        res.json({ success: testDevices.unmark(req.params.id) });
    });

    app.post('/api/test-devices/notice', auth, admin, (req, res) => {
        if (!testDevices.list().length) { refuse(res, 409, 'NO_TEST_DEVICE', 'No test device is set.'); return; }
        const b = req.body || {};
        const mode = b.mode === 'get' ? 'get' : 'push';
        const id = String(b.id || `test:${Date.now().toString(36)}`).slice(0, 120);
        const notice = inbox().publish({
            user: 'test', id, push: mode === 'push', alert: b.alert === true ? true : undefined,
            title: String(b.title || 'Test notice'), text: String(b.text || ''), cls: String(b.cls || 'test'), app: String(b.app || 'test'),
            actions: Array.isArray(b.actions) ? b.actions : [], data: b.data && typeof b.data === 'object' ? b.data : {},
            ttlMs: Number(b.ttlMs) || 6 * 60 * 60 * 1000
        });
        if (!notice) { refuse(res, 400, 'NOT_STORED', 'The notice was not stored (no title, or already expired).'); return; }
        res.json({ success: true, mode, notice });
    });

    app.post('/api/test-devices/notice/:nid/clear', auth, admin, (req, res) => {
        res.json({ success: inbox().clear('test', String(req.params.nid || ''), 'test-harness') });
    });

    app.delete('/api/test-devices/notices', auth, admin, (req, res) => {
        const ids = inbox().list('test').map((n) => n.id);
        let n = 0;
        for (const id of ids) if (inbox().clear('test', id, 'test-harness')) n += 1;
        res.json({ success: true, cleared: n });
    });

    app.post('/api/test-devices/:id/catch-up', auth, admin, (req, res) => {
        const id = String(req.params.id || '').toLowerCase();
        if (!testDevices.isTestDevice(id)) { refuse(res, 404, 'NOT_TEST_DEVICE', 'Not a test device.'); return; }
        res.json({ success: true, sent: inbox().catchUpPhone(id) });
    });

    app.get('/api/test-devices/deliveries', auth, admin, (req, res) => {
        const device = req.query.device ? String(req.query.device).toLowerCase() : null;
        res.json({ success: true, deliveries: inbox().deliveries('test', device) });
    });
}

module.exports = { mount };
