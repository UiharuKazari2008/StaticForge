const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ConfigEditorService = require('../modules/configEditorService');
const configEditorHandler = require('../modules/ws/handlers/20-configEditorHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

const MASK = ConfigEditorService.SECRET_MASK;

const SECRETS = {
    password: 's3cret-pass-VALUE',
    officeCode: 'OC-99-VALUE',
    apiKey: 'ak-live-VALUE',
    wildcardCred: 'wild-cred-VALUE',
    loginKey: 'lk-VALUE',
    replicationToken: 'rt-VALUE',
    replicationReadToken: 'rrt-VALUE',
    grimoireBrowserToken: 'gbt-VALUE',
    guacPassword: 'gpw-VALUE'
};

function clone(v) {
    return JSON.parse(JSON.stringify(v));
}

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeStore() {
    return {
        config: {
            publicName: 'shown',
            password: SECRETS.password,
            officeCode: SECRETS.officeCode,
            theme: 'dark',
            nest: {
                apiKey: SECRETS.apiKey,
                visible: 1
            },
            providers: {
                grok: { credential: SECRETS.wildcardCred, label: 'Grok' }
            }
        },
        secureConfig: {
            loginKey: SECRETS.loginKey,
            location: { latitude: 12.5 },
            replication: {
                replicationToken: SECRETS.replicationToken,
                replicationReadToken: SECRETS.replicationReadToken
            },
            grimoireBrowserToken: SECRETS.grimoireBrowserToken,
            guacRemote: { guacPassword: SECRETS.guacPassword }
        }
    };
}

function makeService() {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runes-maps-'));
    writeJson(path.join(mapsDir, 'index.json'), {
        configs: [
            { id: 'config', label: 'Application Config', configType: 'config', mapFile: 'config.map.json' },
            { id: 'secureConfig', label: 'Secure Config', configType: 'secureConfig', mapFile: 'secureConfig.map.json' }
        ]
    });
    writeJson(path.join(mapsDir, 'config.map.json'), {
        configId: 'config',
        label: 'Application Config',
        rules: [
            { path: [], type: 'object', label: 'Application Config' },
            { path: ['publicName'], type: 'string', label: 'Public Name' },
            { path: ['password'], type: 'string', secret: true, label: 'Password' },
            { path: ['officeCode'], type: 'string', secret: true, label: 'Office Code' },
            { path: ['theme'], type: 'string', enum: ['dark', 'light', null] },
            { path: ['nest'], type: 'object' },
            { path: ['nest', 'apiKey'], type: 'string', secret: true },
            { path: ['nest', 'visible'], type: 'number' },
            { path: ['providers'], type: 'object' },
            { path: ['providers', '*'], type: 'object' },
            { path: ['providers', '*', 'credential'], type: 'string', secret: true },
            { path: ['providers', '*', 'label'], type: 'string' }
        ]
    });
    writeJson(path.join(mapsDir, 'secureConfig.map.json'), {
        configId: 'secureConfig',
        label: 'Secure Config',
        rules: [
            { path: [], type: 'object', label: 'Secure Config' },
            { path: ['location'], type: 'object' },
            { path: ['location', 'latitude'], type: 'number', secret: false },
            { path: ['loginKey'], type: 'string', secret: true }
        ]
    });

    const store = makeStore();
    const saved = [];
    const globalResources = {
        getPath(key) {
            if (key === 'configMaps') return mapsDir;
            throw new Error(`unexpected getPath ${key}`);
        },
        getConfig() { return clone(store.config); },
        getSecureConfig() { return clone(store.secureConfig); },
        flushAllPendingConfigSaves() {},
        configManager: {
            getConfigTypes() { return ['config', 'secureConfig']; },
            saveConfig(configType, data) {
                saved.push({ configType, data: clone(data) });
                store[configType] = clone(data);
            }
        }
    };
    return {
        service: new ConfigEditorService(globalResources),
        store,
        saved,
        mapsDir
    };
}

function assertNoSecretLeak(payload, label) {
    const json = JSON.stringify(payload);
    for (const [name, value] of Object.entries(SECRETS)) {
        assert.ok(!json.includes(value), `${label} leaked ${name}`);
    }
}

function findResult(results, configId, path) {
    return results.find((r) => (
        r.configId === configId
        && r.path.length === path.length
        && r.path.every((seg, i) => String(seg) === String(path[i]))
    ));
}

async function main() {
    const { service, store } = makeService();

    const root = service.getNode('config', []);
    assertNoSecretLeak(root, 'getNode root');
    assert.strictEqual(root.nodeValue.password, MASK);
    assert.strictEqual(root.nodeValue.officeCode, MASK);
    assert.strictEqual(root.nodeValue.nest.apiKey, MASK);
    assert.strictEqual(root.nodeValue.providers.grok.credential, MASK);
    assert.strictEqual(root.nodeValue.publicName, 'shown');
    assert.strictEqual(root.nodeValue.nest.visible, 1);
    const passwordChild = root.children.find((c) => c.key === 'password');
    assert.ok(passwordChild.secret);
    assert.strictEqual(passwordChild.value, MASK);
    const publicChild = root.children.find((c) => c.key === 'publicName');
    assert.strictEqual(publicChild.secret, false);
    assert.strictEqual(publicChild.value, 'shown');

    const nest = service.getNode('config', ['nest']);
    assertNoSecretLeak(nest, 'getNode object');
    assert.strictEqual(nest.nodeValue.apiKey, MASK);
    assert.strictEqual(nest.nodeValue.visible, 1);
    const nestKey = nest.children.find((c) => c.key === 'apiKey');
    assert.ok(nestKey.secret);
    assert.strictEqual(nestKey.value, MASK);

    const leaf = service.getNode('config', ['password']);
    assertNoSecretLeak(leaf, 'getNode leaf');
    assert.strictEqual(leaf.nodeValue, MASK);
    assert.ok(leaf.node.secret);

    const publicLeaf = service.getNode('config', ['publicName']);
    assert.strictEqual(publicLeaf.nodeValue, 'shown');
    assert.strictEqual(publicLeaf.node.secret, false);

    const office = service.getNode('config', ['officeCode']);
    assert.strictEqual(office.nodeValue, MASK);
    assert.ok(office.node.secret, 'secret:true rule must mask a non-regex name');

    const wildcard = service.getNode('config', ['providers', 'grok', 'credential']);
    assert.strictEqual(wildcard.nodeValue, MASK);

    const secureRoot = service.getNode('secureConfig', []);
    assertNoSecretLeak(secureRoot, 'getNode secure root');
    assert.strictEqual(secureRoot.nodeValue.loginKey, MASK);
    assert.strictEqual(secureRoot.nodeValue.grimoireBrowserToken, MASK);
    assert.strictEqual(secureRoot.nodeValue.replication.replicationToken, MASK);
    assert.strictEqual(secureRoot.nodeValue.replication.replicationReadToken, MASK);
    assert.strictEqual(secureRoot.nodeValue.guacRemote.guacPassword, MASK);
    assert.strictEqual(secureRoot.nodeValue.location.latitude, 12.5, 'secret:false opts out of secure default');

    const publicSearch = service.search('shown', { configId: 'config' });
    const shownHit = findResult(publicSearch.results, 'config', ['publicName']);
    assert.ok(shownHit, 'non-secret values remain searchable');
    assert.strictEqual(shownHit.valuePreview, 'shown');

    const search = service.search('VALUE', { maxResults: 50 });
    assertNoSecretLeak(search, 'search');
    const publicHit = findResult(search.results, 'config', ['publicName']);
    assert.ok(!publicHit, 'publicName does not contain VALUE');
    const passHit = findResult(search.results, 'config', ['password']);
    if (passHit) {
        assert.strictEqual(passHit.valuePreview, null);
        assert.ok(passHit.secret);
    }
    const tokenSearch = service.search('replicationToken', { configId: 'secureConfig' });
    assertNoSecretLeak(tokenSearch, 'secure search');
    const tokenHit = findResult(tokenSearch.results, 'secureConfig', ['replication', 'replicationToken']);
    if (tokenHit) {
        assert.strictEqual(tokenHit.valuePreview, null);
        assert.ok(tokenHit.secret);
    }

    const left = { password: SECRETS.password, publicName: 'a', nest: { apiKey: SECRETS.apiKey, visible: 1 } };
    const right = { password: 'other-secret', publicName: 'b', nest: { apiKey: SECRETS.apiKey, visible: 2 } };
    const diff = {
        left: service.maskValueForClient('config', left, []),
        right: service.maskValueForClient('config', right, [])
    };
    assertNoSecretLeak(diff, 'diff / checkpoint compare');
    assert.strictEqual(diff.left.password, MASK);
    assert.strictEqual(diff.right.password, MASK);
    assert.strictEqual(diff.left.publicName, 'a');
    assert.strictEqual(diff.right.publicName, 'b');
    assert.strictEqual(diff.right.nest.visible, 2);

    const revealed = service.revealSecretValue('config', ['password']);
    assert.strictEqual(revealed.value, SECRETS.password);

    const revealedOffice = service.revealSecretValue('config', ['officeCode']);
    assert.strictEqual(revealedOffice.value, SECRETS.officeCode);

    const revealedSecure = service.revealSecretValue('secureConfig', ['guacRemote', 'guacPassword']);
    assert.strictEqual(revealedSecure.value, SECRETS.guacPassword);

    assert.throws(() => service.revealSecretValue('config', ['nest']), /leaf/i);
    assert.throws(() => service.revealSecretValue('config', ['publicName']), /not a secret/i);
    assert.throws(() => service.revealSecretValue('config', []), /Path required/);

    const keepLeaf = makeService();
    keepLeaf.service.applyPatches({
        config: [{ path: ['password'], value: MASK }]
    });
    assert.strictEqual(keepLeaf.store.config.password, SECRETS.password, 'leaf placeholder keeps stored value');

    const keepObject = makeService();
    keepObject.service.applyPatches({
        config: [{
            path: ['nest'],
            value: { apiKey: MASK, visible: 9 }
        }]
    });
    assert.strictEqual(keepObject.store.config.nest.apiKey, SECRETS.apiKey, 'object placeholder keeps stored secret');
    assert.strictEqual(keepObject.store.config.nest.visible, 9);

    const keepRaw = makeService();
    keepRaw.service.applyPatches({
        config: [{
            path: ['providers'],
            value: {
                grok: { credential: MASK, label: 'Updated' }
            }
        }]
    });
    assert.strictEqual(
        keepRaw.store.config.providers.grok.credential,
        SECRETS.wildcardCred,
        'raw JSON placeholder keeps stored secret'
    );
    assert.strictEqual(keepRaw.store.config.providers.grok.label, 'Updated');

    const overwrite = makeService();
    overwrite.service.applyPatches({
        config: [{ path: ['password'], value: 'new-pass' }]
    });
    assert.strictEqual(overwrite.store.config.password, 'new-pass');

    const coerced = service._coerceValue('null', { enum: ['dark', 'light', null], type: 'string' });
    assert.strictEqual(coerced, null);
    assert.ok(coerced === null, 'enum "null" string must become real null');

    const coercedKeep = service._coerceValue('dark', { enum: ['dark', 'light', null], type: 'string' });
    assert.strictEqual(coercedKeep, 'dark');

    let sentError = null;
    let sentPayload = null;
    const logs = [];
    const origInfo = console.info;
    const origError = console.error;
    console.info = (...args) => { logs.push(args.map(String).join(' ')); };
    console.error = () => {};

    const mockHandlersCtx = {
        sendError: (ws, message, code, requestId) => {
            sentError = { message, code, requestId };
        },
        sendToClient: (ws, payload) => {
            sentPayload = payload;
        },
        globalResources: {
            getConfigEditorService: () => ({
                revealSecretValue: (configId, revealPath) => {
                    assert.strictEqual(configId, 'config');
                    assert.deepStrictEqual(revealPath, ['password']);
                    return { value: SECRETS.password };
                }
            })
        }
    };

    configEditorHandler.registerPackets(mockHandlersCtx);
    const revealHandler = wsPacketRegistry.getWsPacketHandler('config_editor_reveal_secret');
    assert.ok(revealHandler, 'config_editor_reveal_secret handler should be registered');

    sentError = null;
    sentPayload = null;
    await revealHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_reveal_secret', configId: 'config', path: ['password'], requestId: 'r1' },
        clientInfo: { userType: 'user', sessionId: 'sess-1' },
        wsServer: {}
    });
    assert.ok(sentError, 'Non-admin reveal should trigger sendError');
    assert.strictEqual(sentError.code, 'FORBIDDEN');
    assert.strictEqual(sentPayload, null);

    sentError = null;
    sentPayload = null;
    logs.length = 0;
    await revealHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_reveal_secret', file: 'config', path: ['password'], requestId: 'r2' },
        clientInfo: { userType: 'admin', sessionId: 'sess-admin' },
        wsServer: {}
    });
    assert.strictEqual(sentError, null, 'Admin reveal should not be forbidden');
    assert.strictEqual(sentPayload?.data?.value, SECRETS.password);
    const logText = logs.join('\n');
    assert.ok(logText.includes('config'), 'reveal log should include file');
    assert.ok(logText.includes('password'), 'reveal log should include path');
    assert.ok(!logText.includes(SECRETS.password), 'reveal log must not include the value');

    console.info = origInfo;
    console.error = origError;

    

// Undefined stored + nested MASK must not persist mask literals; leaf MASK with no
// stored value must stay skippable (SECRET_MASK) for applyPatches.
{
const { service: svc } = makeService();
const mask = ConfigEditorService.SECRET_MASK;
const rehydratedNew = svc._rehydrateMaskedValue(
{ api_key: mask, other: 'ok' },
undefined,
'config',
['brand_new']
);
assert.strictEqual(rehydratedNew.api_key, mask, 'MASK + missing stored must remain MASK so save can skip');
assert.strictEqual(rehydratedNew.other, 'ok', 'non-mask fields still apply under missing stored parent');
const rehydratedPartial = svc._rehydrateMaskedValue(
{ api_key: mask, name: 'x' },
{ name: 'old' },
'config',
['nested']
);
assert.strictEqual(rehydratedPartial.api_key, mask, 'MASK + undefined stored key must remain MASK');
assert.strictEqual(rehydratedPartial.name, 'x', 'plain fields update');
const rehydratedKeep = svc._rehydrateMaskedValue(
{ api_key: mask },
{ api_key: 'real-secret-value' },
'config',
['nested']
);
assert.strictEqual(rehydratedKeep.api_key, 'real-secret-value', 'MASK + stored secret must restore stored');
}

console.log('test-config-editor-secrets: ok');
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
