'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function verifyUiTemplate() {
    console.log('🧪 Verifying UI template & JS component cleanups in securityCenterDsapApplet.js...');

    const filePath = path.join(process.cwd(), 'public', 'scripts', 'comp', 'securityCenterDsapApplet.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Verify Import Host Login button is removed
    assert.strictEqual(content.includes('secCursorAccountsImportHostBtn'), false, 'secCursorAccountsImportHostBtn must be removed');
    assert.strictEqual(content.includes('Import Host Login'), false, 'Text "Import Host Login" must be removed');

    // 2. Verify duplicate Wren/Xi capture & logout buttons are removed
    assert.strictEqual(content.includes('secCaptureWrenAccount'), false, 'secCaptureWrenAccount must be removed');
    assert.strictEqual(content.includes('secLogoutWrenAccount'), false, 'secLogoutWrenAccount must be removed');
    assert.strictEqual(content.includes('secCaptureXiAccount'), false, 'secCaptureXiAccount must be removed');
    assert.strictEqual(content.includes('secLogoutXiAccount'), false, 'secLogoutXiAccount must be removed');

    // 3. Verify Table Row Actions (Capture 📷, Edit ✏️, Delete 🗑️) exist
    assert.strictEqual(content.includes('data-sec-action="capture-cursor-account"'), true, 'capture-cursor-account action must exist');
    assert.strictEqual(content.includes('data-sec-action="edit-cursor-account"'), true, 'edit-cursor-account action must exist');
    assert.strictEqual(content.includes('data-sec-action="delete-cursor-account"'), true, 'delete-cursor-account action must exist');

    console.log('✅ UI template verification passed cleanly!');
}

verifyUiTemplate();
