// Alchemy (StaticForge): Chromium's network error page (neterror.html) and its security interstitials
// (interstitial_large.html) drawn as Internet Explorer 7's own pages on Windows Vista: ieframe.dll's res:// pages
// dnserror.htm, http_400/403/404/406/410/500/501.htm, http_gen.htm, servbusy.htm, syntax.htm, invalidcert.htm and
// phishsite.htm, with their markup, text and images. "Internet Explorer" reads Alchemy (the engine that shows web
// pages in Grimoire). Chromium's page stays in the document, hidden; its data (loadTimeDataRaw) and command
// plumbing (errorPageController, certificateErrorPageController, its own buttons) do the work. The interstitial
// runs under Trusted Types with no policy, so everything is built with DOM calls and textContent, never markup.
(function() {
  'use strict';

  const PRODUCT = 'Alchemy';
  const NBSP = ' ';

  function data() {
    return window.loadTimeDataRaw || {};
  }

  // el('td', {width: '60', class: 'x'}, child, 'text', ...)
  function el(tag, attrs) {
    const node = document.createElement(tag);
    for (const key in attrs || {}) {
      if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
    }
    for (let i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }

  function add(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach((c) => add(node, c));
    } else {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }

  // the image's data: URL from alchemy_ie.css (.alchemy-ie-src-bullet's background), which grit inlined
  const urls = {};
  function imageUrl(name) {
    if (!(name in urls)) {
      const probe = el('i', {class: 'alchemy-ie-src-' + name, hidden: ''});
      document.documentElement.appendChild(probe);
      const match = /^url\((['"]?)(.*)\1\)$/.exec(getComputedStyle(probe).backgroundImage);
      probe.remove();
      urls[name] = match ? match[2] : '';
    }
    return urls[name];
  }

  // img('bullet actionIcon')
  function img(cls, alt) {
    const node = el('img', {class: cls, alt: alt || '', border: '0'});
    node.src = imageUrl(cls.split(' ')[0]);
    return node;
  }

  function setImage(node, name) {
    node.src = imageUrl(name);
  }

  function link(text, action) {
    const a = el('a', {href: '#'}, text);
    a.addEventListener('click', (event) => {
      event.preventDefault();
      action();
    });
    return a;
  }

  // -- the page: ieframe.dll's 730 px table: icon, title, (sub-title), error code over the divider, then rows --

  function page(opts) {
    const table = el('table', {width: '730', cellpadding: '0', cellspacing: '0', border: '0'});
    const iconRows = opts.sub != null ? 3 : 2;
    const icon = opts.icon === 'shield' ? img('shield48', 'Shield icon') : img('info48', 'Info icon');
    add(table, el('tr', null,
        el('td', {width: '60', align: 'left', valign: 'top', rowspan: iconRows}, icon),
        el('td', {valign: 'middle', align: 'left', width: '*'}, el('h1', {id: 'mainTitle'}, opts.title))));
    if (opts.sub != null) add(table, el('tr', null, el('td', null, el('h3', null, el('div', {id: 'linkdiv'}, opts.sub)))));
    add(table, el('tr', null,
        el('td', {class: 'errorCodeAndDivider', align: 'right'}, NBSP + (opts.code || ''), el('div', {class: 'divider'}))));
    for (const row of opts.rows) {
      if (!row) continue;
      add(table, el('tr', null, el('td', {align: row.right ? 'right' : null, valign: row.right ? 'top' : null}, NBSP), row.cell));
    }
    return table;
  }

  function cell(attrs) {
    const args = Array.prototype.slice.call(arguments, 1);
    return {cell: el.apply(null, ['td', Object.assign({align: 'left', valign: 'middle'}, attrs)].concat(args))};
  }

  function causes(header, items) {
    return cell({valign: 'top'}, el('h3', null, header), el('ul', null, items.map((t) => el('li', null, t))));
  }

  function whatToTry() {
    return cell({valign: 'top'}, el('h2', null, 'What you can try:'));
  }

  // a task link row: <h4><table><tr><td><img class=actionIcon></td><td>content</td></tr></table></h4>
  function task(iconCls, content, valign) {
    const v = valign === undefined ? 'top' : valign;
    return cell(null, el('h4', null, el('table', null, el('tr', null,
        el('td', {valign: v}, img(iconCls + ' actionIcon')),
        el('td', {valign: v}, content)))));
  }

  // "More information": the arrow and the link toggle the block below, as expandCollapse() does
  function moreInfo(block, label, onFirstOpen) {
    const arrow = img('down actionIcon', label || 'More information');
    const info = el('div', {class: 'infoBlock', style: 'display: none'}, block);
    let opened = false;
    const toggle = () => {
      const open = info.style.display === 'none';
      info.style.display = open ? 'block' : 'none';
      setImage(arrow, open ? 'up' : 'down');
      if (open && !opened && onFirstOpen) onFirstOpen();
      if (open) opened = true;
    };
    const row = cell(null,
        el('h4', null, el('table', null, el('tr', null,
            el('td', {valign: 'top'}, link([arrow], toggle)),
            el('td', {valign: 'top'}, el('span', null, link(label || 'More information', toggle)))))),
        info);
    row.right = true;
    return row;
  }

  function show(root, opts) {
    const wrap = el('div', {id: 'alchemy-ie', class: opts.quirks ? 'ie-quirks' : null}, root);
    document.body.insertBefore(wrap, document.body.firstChild);
    if (opts.securityError) document.body.classList.add('ie-security-error');
    if (opts.title) document.title = opts.title;
    document.documentElement.classList.add('alchemy-ie-ready');
    const old = document.getElementById('alchemy-ie-old');
    if (old) old.remove();
  }

  function replace(root, opts) {
    const current = document.getElementById('alchemy-ie');
    if (current) current.id = 'alchemy-ie-old';
    show(root, opts);
  }

  // -- network errors (neterror.html) --

  function reload() {
    const d = data();
    if (window.errorPageController) {
      window.errorPageController.reloadButtonClick(d.reloadButton ? d.reloadButton.reloadUrl : undefined);
    } else if (d.reloadButton && d.reloadButton.reloadUrl) {
      location.href = d.reloadButton.reloadUrl;
    } else {
      location.reload();
    }
  }

  function goBack() {
    return history.length > 1 ? link('Go back to the previous page.', () => history.back()) : 'Go back to the previous page.';
  }

  function failedUrl() {
    const d = data();
    return d.reloadButton && d.reloadButton.reloadUrl ? d.reloadButton.reloadUrl : '';
  }

  // initHomepage(): "Go to <host> and look for the information you want."
  function mainSite() {
    let home = null;
    try {
      const url = new URL(failedUrl());
      if (/^https?:$/.test(url.protocol)) home = el('a', {href: url.origin + '/'}, url.host);
    } catch (_) {}
    return ['Go to ', home || 'the main site', NBSP + 'and look for the information you want.'];
  }

  const HTTP_REASONS = {
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found',
    405: 'Method Not Allowed', 406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout',
    409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Request Entity Too Large',
    414: 'Request-URI Too Long', 415: 'Unsupported Media Type', 416: 'Requested Range Not Satisfiable',
    417: 'Expectation Failed', 429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
  };

  function helpBlock(text) {
    return [el('p', null, text), el('p', null, 'For more information about HTTP errors, see Help.')];
  }

  function httpPage(code) {
    const tag = 'HTTP ' + code;
    const named = tag + (HTTP_REASONS[code] ? ' ' + HTTP_REASONS[code] : '');
    const retype = task('bullet', 'Retype the address.');
    const back = task('bullet', goBack());
    const refresh = task('bullet', link('Refresh the page.', reload));
    const typo = 'There might be a typing error in the address.';
    const stale = 'If you clicked on a link, it may be out of date.';
    if (code === 400 || code === 404) {
      return {title: 'The webpage cannot be found', code: tag, rows: [
        causes('Most likely causes:', [typo, stale]), whatToTry(), retype, back, task('bullet', mainSite()),
        moreInfo(helpBlock(code === 400 ?
          'This error (HTTP 400 Bad Request) means that ' + PRODUCT + ' was able to connect to the web server, but the webpage could not be found because of a problem with the address.' :
          'This error (HTTP 404 Not Found) means that ' + PRODUCT + ' was able to connect to the website, but the page you wanted was not found. It\'s possible that the webpage is temporarily unavailable. Alternatively, the website might have changed or removed the webpage.'))]};
    }
    if (code === 403) {
      return {title: 'The website declined to show this webpage', code: tag, rows: [
        causes('Most likely causes:', ['This website requires you to log in.']), whatToTry(), back,
        moreInfo(helpBlock('This error (HTTP 403 Forbidden) means that ' + PRODUCT + ' was able to connect to the website, but it does not have permission to view the webpage.'))]};
    }
    if (code === 406) {
      return {title: PRODUCT + ' cannot read this webpage format', code: tag, rows: [
        whatToTry(), back,
        moreInfo(helpBlock('This error (HTTP 406 Not Acceptable) means that ' + PRODUCT + ' was able to receive information from the website you visited, but the information was not in a format that ' + PRODUCT + ' can display.'))]};
    }
    if (code === 408 || code === 409) {
      return {title: 'The website is too busy to show the webpage', code: tag, rows: [
        whatToTry(), refresh, back,
        moreInfo(helpBlock('This error (HTTP 408 Request Timeout or HTTP 409 Conflict) means that the server took too long to display the page or there were too many people requesting the same webpage.'))]};
    }
    if (code === 410) {
      return {title: 'The webpage no longer exists', code: tag, rows: [
        whatToTry(), back,
        moreInfo(helpBlock('This error (HTTP 410 Gone) means that ' + PRODUCT + ' was able to connect to the website, but the webpage you are trying to view cannot be found.'))]};
    }
    if (code === 500) {
      return {title: 'The website cannot display the page', code: tag, rows: [
        causes('Most likely causes:', ['The website is under maintenance.', 'The website has a programming error.']),
        whatToTry(), refresh, back,
        moreInfo(helpBlock('This error (HTTP 500 Internal Server Error) means that the website you are visiting had a server problem which prevented  the webpage from displaying.'))]};
    }
    if (code === 501 || code === 505) {
      return {title: 'The website is unable to display the webpage', code: tag, rows: [
        whatToTry(), back,
        moreInfo(helpBlock('This error (HTTP 501 Not Implemented or HTTP 505 Version Not Supported) means that the website you are visiting doesn\'t currently have the ability to display the webpage, or support the HTTP version used to request the page.'))]};
    }
    // http_gen.htm, with the real status in place of its 405
    return {title: 'The website cannot display the page', code: tag, rows: [
      causes('Most likely cause:', ['The website has a programming error.']), whatToTry(),
      code >= 500 ? refresh : null, back,
      moreInfo(helpBlock('This error (' + named + ') means that ' + PRODUCT + ' was able to connect to the website, but the site has a programming error.'))]};
  }

  function syntaxPage() {
    return {title: 'The address is not valid', code: '', rows: [
      causes('Most likely causes:', ['There might be a typing error in the address.', 'If you clicked on a link, it may be out of date.']),
      whatToTry(), task('bullet', 'Retype the address.'), task('bullet', goBack())]};
  }

  // dnserror.htm: everything else that kept the page from loading. "Diagnose Connection Problems" ran Windows
  // Network Diagnostics, which ends by trying again; Chromium on Linux has no diagnostics, so it tries again.
  function dnsPage(code) {
    return {title: PRODUCT + ' cannot display the webpage', code, rows: [
      causes('Most likely causes:', ['You are not connected to the Internet.', 'The website is encountering problems.', 'There might be a typing error in the address.']),
      whatToTry(),
      task('bullet', link('Diagnose Connection Problems', reload)),
      moreInfo([
        // as the parser reads ieframe.dll's <p>text<ul>/<ol>: the list closes the paragraph, it is not inside it
        el('p', null, 'This problem can be caused by a variety of issues, including:'),
            el('ul', null,
                el('li', null, 'Internet connectivity has been lost.'),
                el('li', null, 'The website is temporarily unavailable.'),
                el('li', null, 'The Domain Name Server (DNS) is not reachable.'),
                el('li', null, 'The Domain Name Server (DNS) does not have a listing for the website\'s domain.'),
                el('li', null, 'If this is an HTTPS (secure) address, click Tools, click Internet Options, click Advanced, and check to be sure the SSL and TLS protocols are enabled under the security section.')),
        el('p', null, el('b', null, 'For offline users')),
        el('p', null, 'You can still view subscribed feeds and some recently viewed webpages.', el('br'),
            'To view subscribed feeds'),
        el('ol', null, el('li', null, 'Click the Favorites Center button ', img('favcenter'), ', click Feeds, and then click the feed you want to view.')),
        el('p', null, 'To view recently visited webpages (might not work on all pages)'),
        el('ol', null,
            el('li', null, 'Click Tools ', img('tools'), ', and then click Work Offline.'),
            el('li', null, 'Click the Favorites Center button ', img('favcenter'), ', click History, and then click the page you want to view.'))])]};
  }

  function netErrorPage() {
    const d = data();
    const code = String(d.errorCode || '');
    const http = /^HTTP ERROR (\d+)/.exec(code);
    let p;
    if (http) p = httpPage(Number(http[1]));
    else if (/^(ERR_INVALID_URL|ERR_UNKNOWN_URL_SCHEME|ERR_DISALLOWED_URL_SCHEME)$/.test(code)) p = syntaxPage();
    else p = dnsPage(code);
    replace(page({icon: 'info', title: p.title, code: p.code, rows: p.rows}), {title: p.title});
  }

  // No dinosaur: an offline error would start Chromium's game (it takes the space and arrow keys) behind this page.
  function quietDino(d) {
    if (!d) return;
    if (d.iconClass === 'icon-offline') d.iconClass = 'icon-generic';
    d.isOfflineError = false;
  }

  function setupNetError() {
    netErrorPage();
    // a DNS probe's result re-renders Chromium's page with new data (NetErrorTabHelper)
    const probe = window.updateForDnsProbe;
    if (typeof probe === 'function') {
      window.updateForDnsProbe = function(newData) {
        quietDino(newData);
        probe(newData);
        window.loadTimeDataRaw = newData;
        netErrorPage();
      };
    }
  }

  // -- security interstitials (interstitial_large.html) --

  function command(name, id) {
    const controller = window.certificateErrorPageController;
    if (controller && typeof controller[name] === 'function') {
      controller[name]();
    } else if (window.domAutomationController) {
      window.domAutomationController.send(id);
    }
  }

  const dontProceed = () => command('dontProceed', 0);
  const proceed = () => command('proceed', 1);
  let moreShown = false;
  const showMore = () => {
    if (!moreShown) command('showMoreSection', 2);
    moreShown = true;
  };

  // invalidcert.js's L_Cert*_TEXT, by Chromium's certificate error
  const CERT_TEXT = {
    ERR_CERT_AUTHORITY_INVALID: 'The security certificate presented by this website was not issued by a trusted certificate authority.',
    ERR_CERT_DATE_INVALID: 'The security certificate presented by this website has expired or is not yet valid.',
    ERR_CERT_COMMON_NAME_INVALID: 'The security certificate presented by this website was issued for a different website\'s address.',
    ERR_CERT_REVOKED: 'This organization\'s certificate has been revoked.',
  };

  function closeRow() {
    return cell({id: 'closeWebpageAlign'}, el('h4', {id: 'closeWebpage'},
        img('green-shield actionIcon', 'Recommended icon'), link('Click here to close this webpage.', dontProceed)));
  }

  function certPage(d) {
    const code = String(d.errorCode || '').replace(/^net::/i, '');
    const revoked = code === 'ERR_CERT_REVOKED';
    const reason = CERT_TEXT[code] || 'The security certificate presented by this website has errors, and should not be trusted.';
    const overridable = !!d.overridable && !revoked;
    return {
      title: 'Certificate Error: Navigation Blocked', heading: 'There is a problem with this website\'s security certificate.',
      icon: 'shield', sub: '', code: String(d.errorCode || ''),
      rows: [
        cell({valign: null, align: null}, el('h3', null, el('div', null, reason), el('br'),
            'Security certificate problems may indicate an attempt to fool you or intercept any data you send to the server.')),
        {cell: el('td', null, el('h2', {id: 'recommendation'}, el('b', null, 'We recommend that you close this webpage and do not continue to this website. ')))},
        closeRow(),
        overridable ? cell({id: 'continueToSiteAlign'}, el('h4', {id: 'continueToSite'},
            img('red-shield actionIcon', 'Not recommended icon'), link('Continue to this website (not recommended).', proceed))) : null,
        // <p><li>: the item closes the paragraph, and the items stand without a list around them
        moreInfo([el('p'),
            el('li', null, 'If you arrived at this page by clicking a link, check the website address in the address bar to be sure that it is the address you were expecting.'),
            el('li', null, 'When going to a website with an address such as https://example.com, try adding the \'www\' to the address, https://www.example.com.'),
            el('li', null, 'If you choose to ignore this error and continue, do not enter private information into the website.'),
          el('p', null, 'For more information, see "Certificate Errors" in ' + PRODUCT + ' Help.')], null, showMore),
      ],
    };
  }

  function phishPage(d) {
    const url = /^https?:/i.test(location.href) ? location.href : '';
    return {
      title: 'Reported Phishing Website: Navigation Blocked', heading: 'This is a reported phishing website',
      icon: 'shield', sub: url, code: '',
      rows: [
        cell({valign: 'top'}, el('h3', null, PRODUCT + ' has determined that this is a reported phishing website.  Phishing websites impersonate other sites and attempt to trick you into revealing personal or financial information.')),
        {cell: el('td', null, el('h2', null, el('b', null, 'We recommend that you close this webpage and do not continue to this website. ')))},
        task('green-shield', link('Click here to close this webpage.', dontProceed), null),
        d.overridable ? task('red-shield', link('Continue to this website (not recommended).', proceed), null) : null,
        moreInfo([
          el('p', null, 'Online phishing (pronounced ', el('b', null, 'fishing'), ') is a way to trick you into revealing personal or financial information through an e-mail message or website. Phishing Filter is a feature in ' + PRODUCT + ' that helps detect phishing or fraudulent websites.'),
          el('p', null, 'For more information, see Phishing in ' + PRODUCT + ' Help.')], null, showMore),
        Object.assign(cell(null, el('h4', null, link('Report that this is not a phishing website.', () => command('reportPhishingError', 12)))), {right: true}),
      ],
    };
  }

  // Every other interstitial (malware, captive portal, wrong clock, lookalike, HTTPS-only, enterprise, ...): no IE
  // page of its own, so Chromium's words in invalidcert.htm's layout; its buttons and links keep their own handlers.
  function genericPage(d) {
    const take = (selector) => {
      const node = document.querySelector(selector);
      return node ? Array.prototype.slice.call(node.childNodes) : [];
    };
    const visible = (node) => node && !node.classList.contains('hidden') && (node.textContent || '').trim();
    const primary = document.getElementById('primary-button');
    const proceedButton = document.getElementById('proceed-button');
    const details = document.getElementById('details-button');
    const info = /^(CAPTIVE_PORTAL|SUPERVISED_USER_VERIFY|SUPERVISED_USER_VERIFY_SUBFRAME|MANAGED_PROFILE_REQUIRED)$/.test(d.type) || d.bad_clock;
    const rows = [cell({valign: 'top'}, el('h3', null, take('#main-message > p')))];
    const blocked = document.getElementById('blocked-site-message');
    if (visible(blocked)) rows.push(cell({valign: 'top'}, el('h3', null, take('#blocked-site-message'))));
    if (visible(primary)) {
      rows.push(cell(null, el('h4', null, img('green-shield actionIcon', 'Recommended icon'),
          link(primary.textContent.trim(), () => primary.click()))));
    }
    if (visible(proceedButton)) {
      rows.push(cell(null, el('h4', null, img('red-shield actionIcon', 'Not recommended icon'),
          link(proceedButton.textContent.trim(), () => proceedButton.click()))));
    }
    if (visible(details)) {
      const block = [];
      document.querySelectorAll('#details > p').forEach((p) => {
        if (!p.classList.contains('hidden')) block.push(el('p', null, Array.prototype.slice.call(p.childNodes)));
      });
      rows.push(moreInfo(block, null, showMore));
    }
    return {
      title: '', icon: info ? 'info' : 'shield', sub: '', heading: take('#main-message h1'), code: String(d.errorCode || ''), rows,
    };
  }

  function interstitialPage() {
    const d = data();
    let p;
    if (d.type === 'SSL' && !d.bad_clock) p = certPage(d);
    else if (d.type === 'SAFEBROWSING' && d.phishing && !d.billing) p = phishPage(d);
    else p = genericPage(d);
    const root = page({icon: p.icon, title: p.heading || p.title, sub: p.sub, code: p.code, rows: p.rows});
    show(root, {title: p.title, securityError: true, quirks: true});
  }

  // This runs from <head>, before <body> exists: which page it is shows at DOMContentLoaded (Chromium's own script,
  // earlier in <head>, has drawn its page by then; the capture listener on window runs before Chromium's).
  const isNetError = () => document.body && document.body.classList.contains('neterror');
  window.addEventListener('DOMContentLoaded', () => {
    if (isNetError()) quietDino(data());
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (isNetError()) {
      setupNetError();
    } else if (document.getElementById('main-content') && window.loadTimeDataRaw && window.loadTimeDataRaw.type) {
      interstitialPage();
    }
  });
})();
