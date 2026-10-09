'use strict';

const assert = require('assert');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');

function testEmailExtraction() {
    console.log('🧪 Testing Email Extraction vs GitHub Username Filter...');

    // 1. JWT with GitHub username "kanmi" and email "kanmi@domain.com"
    const payloadWithBoth = Buffer.from(JSON.stringify({
        sub: 'github|123456',
        name: 'kanmi',
        email: 'kanmi@domain.com'
    })).toString('base64url');
    const tokenWithBoth = `header.${payloadWithBoth}.sig`;

    const extracted1 = cursorAccountAuthStore.extractEmailFromToken(tokenWithBoth);
    assert.strictEqual(extracted1, 'kanmi@domain.com', 'Must extract email kanmi@domain.com, NOT GitHub username kanmi');

    // 2. JWT with bare GitHub username "kanmi" and NO email
    const payloadNoEmail = Buffer.from(JSON.stringify({
        sub: 'github|123456',
        name: 'kanmi'
    })).toString('base64url');
    const tokenNoEmail = `header.${payloadNoEmail}.sig`;

    const extracted2 = cursorAccountAuthStore.extractEmailFromToken(tokenNoEmail);
    assert.strictEqual(extracted2, '', 'Bare GitHub username "kanmi" must NOT be extracted as email');

    // 3. Custom cursor.com scope email
    const payloadCursorScope = Buffer.from(JSON.stringify({
        name: 'kanmi',
        'https://cursor.com/email': 'dev@cursor.sh'
    })).toString('base64url');
    const tokenCursorScope = `header.${payloadCursorScope}.sig`;

    const extracted3 = cursorAccountAuthStore.extractEmailFromToken(tokenCursorScope);
    assert.strictEqual(extracted3, 'dev@cursor.sh', 'Must extract cursor scope email');

    console.log('✅ Email extraction tests passed cleanly!');
}

testEmailExtraction();
