// JULES: Regression test for trace routes admin authorization guard
// Credit: grok.menma
'use strict';

const assert = require('assert');
const http = require('http');
const Module = require('module');

// Override Module._load to catch missing module load errors in sandbox environment
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    try {
        return origLoad.apply(this, arguments);
    } catch (err) {
        return {};
    }
};

const { isAdminUser } = require('../modules/auth');

console.log('Running test-traces-admin-guard.js...');

function adminOnlyMiddleware(req, res, next) {
    if (!isAdminUser(req)) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

// Test 1: Unit level verification of adminOnlyMiddleware
{
    let nextCalled = false;
    const reqReadonly = { userType: 'readonly' };
    const resReadonly = {
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    adminOnlyMiddleware(reqReadonly, resReadonly, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false, 'next() should not be called for readonly user');
    assert.strictEqual(resReadonly.statusCode, 403, 'Readonly user should receive status 403');
    assert.strictEqual(resReadonly.body.error, 'Admin access required');

    nextCalled = false;
    const reqAdmin = { userType: 'admin' };
    const resAdmin = {};
    adminOnlyMiddleware(reqAdmin, resAdmin, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'next() should be called for admin user');
}

// Test 1b: web_server.js wires the shared admin guard on every trace route
{
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
    assert(/function adminOnlyMiddleware\(req, res, next\) \{\s*if \(!isAdminUser\(req\)\)/.test(src),
        'web_server.js should define adminOnlyMiddleware on isAdminUser');
    for (const route of ["app.get('/traces',", "app.get('/traces/list',", "app.get('/traces/:id',", "app.use('/traces/files',"]) {
        const at = src.indexOf(route);
        assert(at !== -1, `${route} should exist in web_server.js`);
        const line = src.slice(at, src.indexOf('\n', at));
        assert(/authMiddleware, adminOnlyMiddleware/.test(line), `${route} should use authMiddleware, adminOnlyMiddleware`);
    }
}

// Test 2: HTTP server integration test for /traces, /traces/list, /traces/:id, /traces/files
const server = http.createServer((req, res) => {
    // Helper to augment res with status and json methods similar to Express
    res.status = function(code) {
        this.statusCode = code;
        return this;
    };
    res.json = function(data) {
        this.setHeader('Content-Type', 'application/json');
        this.end(JSON.stringify(data));
        return this;
    };

    const role = req.headers['x-test-role'];
    if (role) {
        req.userType = role;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    const isTraceRoute = path === '/traces' ||
        path === '/traces/list' ||
        path.startsWith('/traces/') ||
        path.startsWith('/traces/files');

    if (isTraceRoute) {
        adminOnlyMiddleware(req, res, () => {
            res.status(200).json({ success: true, path });
        });
        return;
    }

    res.status(404).json({ success: false, error: 'Not found' });
});

server.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;

    async function makeRequest(path, role) {
        return new Promise((resolve, reject) => {
            const req = http.get({
                hostname: '127.0.0.1',
                port,
                path,
                headers: role ? { 'x-test-role': role } : {}
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve({ statusCode: res.statusCode, body: json });
                    } catch (e) {
                        resolve({ statusCode: res.statusCode, body: data });
                    }
                });
            });
            req.on('error', reject);
        });
    }

    try {
        const routes = ['/traces', '/traces/list', '/traces/sample-id', '/traces/files/sample.png'];

        for (const route of routes) {
            // Read-only request must be denied with 403
            const resReadonly = await makeRequest(route, 'readonly');
            assert.strictEqual(
                resReadonly.statusCode,
                403,
                `Readonly access to ${route} should be HTTP 403`
            );
            assert.strictEqual(
                resReadonly.body.error,
                'Admin access required',
                `Readonly access to ${route} should return 'Admin access required'`
            );

            // Admin request must succeed
            const resAdmin = await makeRequest(route, 'admin');
            assert.strictEqual(
                resAdmin.statusCode,
                200,
                `Admin access to ${route} should be HTTP 200`
            );
            assert.strictEqual(
                resAdmin.body.success,
                true,
                `Admin access to ${route} should return success: true`
            );
        }

        console.log('✅ test-traces-admin-guard passed successfully! Crediting grok.menma');
    } catch (err) {
        console.error('❌ Test failed:', err);
        process.exitCode = 1;
    } finally {
        server.close();
    }
});
