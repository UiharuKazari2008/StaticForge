#!/usr/bin/env node
/**
 * Test program fault reports REST endpoints authentication requirement.
 * Verifies that unauthenticated requests to POST/GET /api/fault-reports are rejected
 * and authenticated requests are processed as expected.
 *
 * Credit: grok.menma
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { mountProgramFaultReports, createStore } = require('../modules/programFaultReports');

async function runTest() {
    console.log('Testing fault reports endpoint auth requirements...');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-reports-auth-test-'));
    const store = createStore({ dir: tmpDir });

    const routes = {};

    // Mock Express app
    const app = {
        post(pathStr, middleware, handler) {
            routes[`POST:${pathStr}`] = { middleware, handler };
        },
        get(pathStr, middleware, handler) {
            routes[`GET:${pathStr}`] = { middleware, handler };
        }
    };

    // Auth middleware requiring authenticated session or x-auth-token header
    const dummyAuthMiddleware = (req, res, next) => {
        if (req.headers && req.headers['x-auth-token'] === 'secret') {
            return next();
        }
        res.status(403).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
    };

    mountProgramFaultReports(app, dummyAuthMiddleware, { store });

    // Helper to simulate request
    function handleRequest(method, pathStr, headers = {}, body = {}, params = {}) {
        let routeKey = `${method}:${pathStr}`;
        if (!routes[routeKey] && pathStr.startsWith('/api/fault-reports/')) {
            routeKey = `${method}:/api/fault-reports/:id`;
        }
        const route = routes[routeKey];
        if (!route) throw new Error(`Route not registered: ${method} ${pathStr}`);

        let statusCode = 200;
        let responseData = null;

        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(data) {
                responseData = data;
                return this;
            }
        };

        const req = { headers, body, params };

        let nextCalled = false;
        route.middleware(req, res, () => {
            nextCalled = true;
            route.handler(req, res);
        });

        return { statusCode, responseData, nextCalled };
    }

    try {
        // 1. Unauthenticated POST /api/fault-reports -> 403
        const unauthPost = handleRequest('POST', '/api/fault-reports', {}, {
            program: { name: 'TestApp', key: 'testapp' },
            message: 'Test crash',
            stack: 'Error: Test crash\n  at test (test.js:1:1)'
        });
        assert.strictEqual(unauthPost.statusCode, 403, 'Unauthenticated POST should be 403');
        assert.strictEqual(unauthPost.responseData.code, 'AUTH_REQUIRED');
        assert.strictEqual(unauthPost.nextCalled, false);

        // 2. Unauthenticated GET /api/fault-reports -> 403
        const unauthGet = handleRequest('GET', '/api/fault-reports', {});
        assert.strictEqual(unauthGet.statusCode, 403, 'Unauthenticated GET should be 403');
        assert.strictEqual(unauthGet.responseData.code, 'AUTH_REQUIRED');

        // 3. Authenticated POST /api/fault-reports -> 200
        const authPost = handleRequest('POST', '/api/fault-reports', { 'x-auth-token': 'secret' }, {
            program: { name: 'TestApp', key: 'testapp' },
            message: 'Test crash',
            stack: 'Error: Test crash\n  at test (test.js:1:1)'
        });
        assert.strictEqual(authPost.statusCode, 200, 'Authenticated POST should be 200');
        assert.strictEqual(authPost.responseData.ok, true);
        const reportId = authPost.responseData.id;
        assert.ok(reportId);

        // 4. Authenticated GET /api/fault-reports/:id -> 200
        const authGetId = handleRequest('GET', `/api/fault-reports/${reportId}`, { 'x-auth-token': 'secret' }, {}, { id: reportId });
        assert.strictEqual(authGetId.statusCode, 200, 'Authenticated GET :id should be 200');
        assert.strictEqual(authGetId.responseData.ok, true);
        assert.strictEqual(authGetId.responseData.report.id, reportId);

        // 5. Unauthenticated GET /api/fault-reports/:id -> 403
        const unauthGetId = handleRequest('GET', `/api/fault-reports/${reportId}`, {}, {}, { id: reportId });
        assert.strictEqual(unauthGetId.statusCode, 403, 'Unauthenticated GET :id should be 403');

        console.log('✅ All fault reports auth tests passed!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTest().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
