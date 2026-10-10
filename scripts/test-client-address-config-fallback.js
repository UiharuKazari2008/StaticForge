// Callers passing null (mcpRequestLog, agentClientBridge) must honour configured apocrypha.trustedProxies.
const assert = require("assert");
const ca = require("../modules/clientAddress");
const req = { headers: { "x-forwarded-for": "203.0.113.9" }, socket: { remoteAddress: "192.168.255.1" } };
assert.notStrictEqual(ca.resolveRequestClientIp(req, ca.trustedProxiesForClientIp(null)).ip, "203.0.113.9", "untrusted before config");
ca.trustedProxiesFromResources({ getConfig: () => ["127.0.0.0/8", "192.168.255.1/32"] });
assert.strictEqual(ca.resolveRequestClientIp(req, ca.trustedProxiesForClientIp(null)).ip, "203.0.113.9");
const spoof = { headers: { "x-forwarded-for": "203.0.113.9" }, socket: { remoteAddress: "192.168.200.50" } };
assert.notStrictEqual(ca.resolveRequestClientIp(spoof, ca.trustedProxiesForClientIp(null)).ip, "203.0.113.9", "other peers still untrusted");
console.log("ok client-address config fallback");
