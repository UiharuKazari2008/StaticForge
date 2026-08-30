/**
 * Render consent page templates to HTML files for screenshot preview.
 * Used for ui-review without needing full server.
 */

const fs = require('fs');
const path = require('path');

const routesSource = fs.readFileSync(
    path.join(__dirname, '../modules/mcpOAuthRoutes.js'),
    'utf8'
);

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Extract PIN_STEP_HTML template
const pinMatch = routesSource.match(/const PIN_STEP_HTML = `([\s\S]*?)`;/);
const pinTemplate = pinMatch ? pinMatch[1] : null;

// Extract KEY_PICKER_HTML template
const keyPickerMatch = routesSource.match(/const KEY_PICKER_HTML = `([\s\S]*?)`;/);
const keyPickerTemplate = keyPickerMatch ? keyPickerMatch[1] : null;

if (!pinTemplate || !keyPickerTemplate) {
    console.error('Could not extract templates from mcpOAuthRoutes.js');
    process.exit(1);
}

// Render PIN step
const pinHtml = pinTemplate
    .replace('{{ERROR_BLOCK}}', '')
    .replace('{{CLIENT_NAME}}', escapeHtml('Grok Custom Connector'))
    .replace('{{SCOPE_LIST}}', '<li>generation</li>\n<li>gallery</li>\n<li>workspace</li>')
    .replace('{{FORM_ACTION}}', '#')
    .replace('{{CLIENT_ID}}', 'mcp_test123')
    .replace('{{REDIRECT_URI}}', 'https://grok.com/callback')
    .replace('{{STATE}}', 'state123')
    .replace('{{SCOPE}}', 'generation gallery workspace')
    .replace('{{CODE_CHALLENGE}}', 'challenge123')
    .replace('{{CODE_CHALLENGE_METHOD}}', 'S256')
    .replace('{{RESOURCE}}', '');

// Render key picker with sample keys
const sampleKeys = [
    {
        id: 'key-1',
        appName: 'Grok Integration (Production)',
        keyPrefix: 'sfapp_Kx7n',
        scopes: ['generation', 'gallery', 'workspace']
    },
    {
        id: 'key-2',
        appName: 'MCP Test Client',
        keyPrefix: 'sfapp_9Pqm',
        scopes: ['universal']
    }
];

let keyOptionsHtml = '';
let hasSelected = false;

for (const key of sampleKeys) {
    const selectedClass = !hasSelected ? ' selected' : '';
    const checkedAttr = !hasSelected ? ' checked' : '';
    hasSelected = true;

    const scopesDisplay = key.scopes.includes('universal')
        ? 'universal'
        : key.scopes.join(', ');

    keyOptionsHtml += `
<label class="key-option${selectedClass}">
<input type="radio" name="selected_key" value="${escapeHtml(key.id)}"${checkedAttr}>
<div class="key-name">${escapeHtml(key.appName)}</div>
<div class="key-prefix">${escapeHtml(key.keyPrefix)}...</div>
<div class="key-scopes">Scopes: ${escapeHtml(scopesDisplay)}</div>
</label>`;
}

keyOptionsHtml += `
<label class="key-option create-new">
<input type="radio" name="selected_key" value="__create_new__">
<div class="key-name">+ Create New Key</div>
<div class="key-scopes">Will have: generation, gallery, workspace</div>
</label>`;

const keyPickerHtml = keyPickerTemplate
    .replace('{{ERROR_BLOCK}}', '')
    .replace('{{CLIENT_NAME}}', escapeHtml('Grok Custom Connector'))
    .replace('{{SCOPE_LIST}}', '<li>generation</li>\n<li>gallery</li>\n<li>workspace</li>')
    .replace('{{FORM_ACTION}}', '#')
    .replace('{{CSRF_TOKEN}}', 'csrf_token_placeholder')
    .replace(/\{\{USER_TYPE\}\}/g, 'admin')
    .replace('{{KEY_OPTIONS}}', keyOptionsHtml);

// Save to files
const outputDir = path.join(__dirname, '../consent-preview');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(path.join(outputDir, 'pin-step.html'), pinHtml);
fs.writeFileSync(path.join(outputDir, 'key-picker.html'), keyPickerHtml);

console.log('Preview files created in consent-preview/');
console.log('  - pin-step.html');
console.log('  - key-picker.html');
console.log('\nOpen these in a browser to see the UI preview.');
