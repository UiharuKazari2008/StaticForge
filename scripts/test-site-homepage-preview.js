#!/usr/bin/env node
'use strict';

const path = require('path');
const siteHomepage = require('../modules/siteHomepageStorage');

const root = path.join(__dirname, '..');
const slugs = siteHomepage.listAvailableSlugs(root);
if (!slugs.length) {
    console.error('test-site-homepage-preview: no slugs in catalog');
    process.exit(1);
}

let failed = 0;
for (const slug of slugs) {
    const hit = siteHomepage.resolvePreviewSiteDir(root, slug);
    const html = siteHomepage.readPreviewHtml(root, slug);
    if (!hit || !html || html.length < 10) {
        console.error('FAIL', slug, hit ? 'empty html' : 'no dir');
        failed++;
        continue;
    }
    console.log('ok', slug, hit.siteDir, html.length, 'bytes');
}

if (failed) process.exit(1);
console.log('test-site-homepage-preview: ok', slugs.length, 'slugs');
