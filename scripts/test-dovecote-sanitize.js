'use strict';

// Dovecote safe-rendering spec: script/iframe/form/on*/style-url stripped,
// remote images blocked by default, links forced to safe targets, markdown
// never lets raw HTML through.

const assert = require('assert');
const { sanitizeHtml } = require('../modules/dovecoteSanitize');
const { markdownToHtml } = require('../modules/dovecoteMarkdown');
const { renderMailBody } = require('../modules/dovecoteRender');

function main() {
    const dirty = [
        '<script>alert(1)</script>',
        '<iframe src="https://evil.example"></iframe>',
        '<form action="https://evil.example"><input></form>',
        '<p onclick="steal()" style="color:red;background:url(https://evil.example/pixel.png)">hi</p>',
        '<a href="javascript:alert(1)">bad link</a>',
        '<a href="https://example.com">good link</a>',
        '<img src="https://example.com/tracker.png">',
        '<img src="data:image/png;base64,AAAA">',
        '<unknown-tag>keep my text</unknown-tag>'
    ].join('');

    const result = sanitizeHtml(dirty);
    assert.ok(!result.html.includes('<script'), 'script tag must be removed');
    assert.ok(!result.html.includes('<iframe'), 'iframe tag must be removed');
    assert.ok(!result.html.includes('<form'), 'form tag must be removed');
    assert.ok(!result.html.includes('onclick'), 'event handlers must be stripped');
    assert.ok(!result.html.includes('url('), 'style url() must be stripped');
    assert.ok(!result.html.includes('javascript:'), 'javascript: links must be stripped');
    assert.ok(result.html.includes('<a href="https://example.com" title="https://example.com" target="_blank" rel="noopener noreferrer">'), 'safe links get target=_blank rel=noopener and a hover title');
    assert.ok(result.html.includes('data-blocked-src="https://example.com/tracker.png"'), 'remote image blocked by default');
    assert.ok(result.html.includes('data:image/png;base64,AAAA'), 'data: images pass through untouched');
    assert.ok(result.html.includes('keep my text'), 'unknown tags unwrap, keeping their text');
    assert.deepStrictEqual(result.remoteImages, ['https://example.com/tracker.png']);
    assert.ok(result.counts.tagsDropped >= 3);
    assert.ok(result.counts.eventHandlersStripped >= 1);
    assert.ok(result.counts.unsafeStyleStripped >= 1);

    // allowRemoteImages / alwaysLoadSenders opt back in explicitly.
    const allowed = sanitizeHtml('<img src="https://example.com/x.png">', { allowRemoteImages: true });
    assert.ok(allowed.html.includes('src="https://example.com/x.png"'));
    assert.strictEqual(allowed.remoteImages.length, 0);

    const alwaysLoad = sanitizeHtml('<img src="https://example.com/x.png">', {
        sender: 'menma',
        alwaysLoadSenders: new Set(['menma'])
    });
    assert.ok(alwaysLoad.html.includes('src="https://example.com/x.png"'));

    // Non-image data: URIs and unknown schemes are dropped outright, not just blocked-pending-load.
    const badScheme = sanitizeHtml('<img src="file:///etc/passwd">');
    assert.ok(!badScheme.html.includes('<img'));

    // Markdown never lets raw HTML through, even before the sanitizer runs.
    const mdHtml = markdownToHtml('# Title\n\n<script>alert(1)</script> and **bold**');
    assert.ok(!mdHtml.includes('<script>alert'));
    assert.ok(mdHtml.includes('&lt;script&gt;'));
    assert.ok(mdHtml.includes('<strong>bold</strong>'));
    assert.ok(mdHtml.includes('<h1>Title</h1>'));

    // renderMailBody covers all three formats and always sanitizes.
    const textRendered = renderMailBody({ body: 'hi <b>there</b>', format: 'text' });
    assert.ok(textRendered.html.includes('&lt;b&gt;'), 'plain text format escapes HTML rather than rendering it');
    assert.strictEqual(textRendered.sanitized, true);

    const mdRendered = renderMailBody({ body: '**bold** <script>alert(1)</script>', format: 'md' });
    assert.ok(mdRendered.html.includes('<strong>bold</strong>'));
    assert.ok(!mdRendered.html.includes('<script>alert'));

    const htmlRendered = renderMailBody({ body: '<script>alert(1)</script><p>ok</p>', format: 'html' });
    assert.ok(!htmlRendered.html.includes('<script'));
    assert.ok(htmlRendered.html.includes('<p>ok</p>'));

    // Bare web addresses become links in every format; trailing punctuation stays text.
    const bare = renderMailBody({ body: 'See https://example.com/a?x=1&y=2. Or www.example.org, and (https://en.wikipedia.org/wiki/Foo_(bar)).', format: 'text' });
    assert.ok(bare.html.includes('<a href="https://example.com/a?x=1&amp;y=2" title="https://example.com/a?x=1&y=2" target="_blank" rel="noopener noreferrer">https://example.com/a?x=1&amp;y=2</a>. Or'), bare.html);
    assert.ok(bare.html.includes('<a href="https://www.example.org"'), 'www. gets https://');
    assert.ok(bare.html.includes('>www.example.org</a>, and'), bare.html);
    assert.ok(bare.html.includes('>https://en.wikipedia.org/wiki/Foo_(bar)</a>).'), bare.html);

    const mdBare = renderMailBody({ body: 'Read **https://example.com/md** and [named](https://example.com/n)', format: 'md' });
    assert.ok(mdBare.html.includes('<strong><a href="https://example.com/md"'), mdBare.html);
    assert.strictEqual((mdBare.html.match(/<a /g) || []).length, 2, 'text inside an existing link is not linked again');

    const htmlBare = sanitizeHtml('<p>Go to https://example.com/h</p><a href="https://example.com/x">https://example.com/x</a>');
    assert.strictEqual((htmlBare.html.match(/<a /g) || []).length, 2, htmlBare.html);

    // Only real web addresses: no javascript:, no bare scheme, escaped markup stays escaped.
    const noLink = renderMailBody({ body: 'javascript:alert(1) http://x <script>https://example.com/"onmouseover=x</script> www.', format: 'text' });
    assert.ok(!/javascript:alert\(1\)<\/a>/.test(noLink.html));
    assert.ok(!noLink.html.includes('<script'), noLink.html);
    assert.ok(!noLink.html.includes('" onmouseover'), noLink.html);
    assert.ok(!/<a [^>]*>(http:\/\/x|www\.)<\/a>/.test(noLink.html), noLink.html);

    console.log('dovecote sanitize/markdown tests passed');
}

main();
