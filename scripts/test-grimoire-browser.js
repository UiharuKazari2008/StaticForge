'use strict';

/**
 * Starts services/grimoire-browser, proves a real Chromium page can be
 * streamed and clicked, then proves Dreamscape's bridge returns an iframe
 * URL on that service (another host/port), not on Dreamscape itself.
 */

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocket } = require('ws');
const { mountGrimoireBrowserBridge } = require('../modules/grimoireBrowserBridge');

const ROOT = path.join(__dirname, '..');
const SERVICE = path.join(ROOT, 'services', 'grimoire-browser', 'server.js');
const TOKEN = crypto.randomBytes(24).toString('hex');

function listen(handler) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, fn, ms) {
    const start = Date.now();
    let last = label;
    while (Date.now() - start < ms) {
        try {
            const value = await fn();
            if (value) return value;
        } catch (err) {
            last = err.message || String(err);
        }
        await sleep(200);
    }
    throw new Error(label + ' timed out (' + last + ')');
}

function killChild(child) {
    return new Promise((resolve) => {
        if (!child || child.exitCode != null) {
            resolve();
            return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
            if (child.exitCode == null) child.kill('SIGKILL');
        }, 4000).unref();
    });
}

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const INSPECT_HTML = '<!DOCTYPE html><title>grim-inspect</title><style>html,body,p,a,div{margin:0}#t{position:absolute;left:8px;top:8px;font:20px/24px sans-serif}#img{position:absolute;left:8px;top:80px;width:48px;height:48px;background:#ccc}#lnk{position:absolute;left:8px;top:160px;font:20px/24px sans-serif}#box{position:absolute;left:8px;top:220px;width:240px;height:40px;font:20px/24px sans-serif}</style><p id="t">hello clipboard</p><img id="img" alt="dot" src="/dot.gif"><a id="lnk" href="/file.bin" download="file.bin">get file</a><div id="box" contenteditable="true"></div>';

async function main() {
    const page = await listen((req, res) => {
        const pathName = (req.url || '/').split('?')[0];
        if (pathName === '/dot.gif') {
            res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
            res.end(GIF);
            return;
        }
        if (pathName === '/file.bin') {
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': 'attachment; filename="file.bin"',
                'Cache-Control': 'no-store'
            });
            res.end(Buffer.from('grim-bytes'));
            return;
        }
        if (pathName === '/stall') return;
        if (pathName === '/opened') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><title>opened-tab</title><p>opened</p>');
            return;
        }
        if (pathName === '/pop') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><title>grim-pop</title><style>html,body,a{margin:0;height:100%;display:block;font:28px sans-serif}</style><a id="b" href="/opened" target="_blank">open</a>');
            return;
        }
        if (pathName === '/passkey') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><title>passkey-wait</title><script>var opts={publicKey:{challenge:new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]),timeout:60000,rpId:location.hostname,userVerification:"required"}};function done(name){document.title="passkey-"+name;}if(!navigator.credentials||!navigator.credentials.get){done("absent");}else{navigator.credentials.get(opts).then(function(){done("allowed");}).catch(function(err){done(err&&err.name||"error");});}</script>');
            return;
        }
        if (pathName === '/tick') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!DOCTYPE html><title>grim-tick</title><style>html,body{margin:0;background:#123;color:#fff;font:48px sans-serif}</style><div id="n">0</div><script>var i=0;setInterval(function(){document.getElementById("n").textContent=String(++i);},40);</script>');
            return;
        }
        if (pathName === '/inspect') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(INSPECT_HTML);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><title>grim-local</title><style>html,body{margin:0;height:100%}button{width:100%;height:100%;font-size:28px}</style><button id="b" onclick="document.title=\'clicked\'">press</button>');
    });
    const pagePort = page.address().port;
    const localUrl = 'http://127.0.0.1:' + pagePort + '/';

    const browser = spawn(process.execPath, [SERVICE], {
        cwd: ROOT,
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: '0',
            GRIMOIRE_BROWSER_TOKEN: TOKEN,
            CHROME_NO_SANDBOX: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let log = '';
    let servicePort = 0;
    browser.stdout.on('data', (chunk) => {
        log += chunk.toString();
        const match = log.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) servicePort = Number(match[1]);
    });
    browser.stderr.on('data', (chunk) => {
        log += chunk.toString();
    });

    try {
        await waitFor('service port', async () => servicePort || null, 20000);
        const base = 'http://127.0.0.1:' + servicePort;
        await waitFor('health', async () => {
            const res = await fetch(base + '/health');
            if (!res.ok) return null;
            const body = await res.json();
            return body.browser ? body : null;
        }, 20000);

        const denied = await fetch(base + '/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: localUrl })
        });
        if (denied.status !== 401) throw new Error('expected 401 without token, got ' + denied.status);

        const created = await fetch(base + '/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + TOKEN
            },
            body: JSON.stringify({ url: localUrl, width: 800, height: 600 })
        });
        const session = await created.json();
        if (created.status !== 201) throw new Error('create failed ' + created.status + ' ' + JSON.stringify(session));
        if (session.viewPath.includes(TOKEN)) throw new Error('admin token leaked into the view path');

        const view = await fetch(base + session.viewPath);
        const html = await view.text();
        const csp = view.headers.get('content-security-policy') || '';
        if (view.status !== 200) throw new Error('view page ' + view.status);
        if (!html.includes('<canvas')) throw new Error('viewer has no canvas');
        if (!csp.includes('frame-ancestors')) throw new Error('viewer missing frame-ancestors: ' + csp);
        if (view.headers.get('x-frame-options')) throw new Error('viewer set X-Frame-Options');

        const wsUrl = 'ws://127.0.0.1:' + servicePort + '/sessions/' + session.id + '/stream?t=' + session.viewerToken;
        const ws = new WebSocket(wsUrl);
        let jpeg = false;
        const controls = [];
        let controlCursor = 0;
        ws.binaryType = 'nodebuffer';
        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) jpeg = true;
                return;
            }
            try { controls.push(JSON.parse(data.toString())); } catch (_) {}
        });
        function nextControl(type, ms) {
            return waitFor(type, async () => {
                for (let i = controlCursor; i < controls.length; i++) {
                    if (controls[i].type === type) {
                        controlCursor = i + 1;
                        return controls[i];
                    }
                }
                return null;
            }, ms || 8000);
        }
        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });

        await waitFor('jpeg frame', async () => jpeg || null, 15000);
        await waitFor('local title', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return body.title === 'grim-local' ? body : null;
        }, 15000);

        for (let i = 0; i < 80; i++) {
            ws.send(JSON.stringify({ type: 'mouse', kind: 'move', x: 8 + (i % 30), y: 8 }));
        }
        ws.send(JSON.stringify({ type: 'mouse', kind: 'click', x: 400, y: 300, button: 'left' }));

        await waitFor('click', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return body.title === 'clicked' ? body : null;
        }, 10000);

        ws.send(JSON.stringify({ type: 'navigate', url: 'http://127.0.0.1:' + pagePort + '/passkey' }));
        await waitFor('passkey blocked', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            if (!body.title || body.title === 'passkey-wait' || body.title === 'clicked') return null;
            if (body.title === 'passkey-allowed') throw new Error('passkey prompt was allowed');
            return body.title;
        }, 4000);

        const inspectUrl = 'http://127.0.0.1:' + pagePort + '/inspect';
        ws.send(JSON.stringify({ type: 'navigate', url: inspectUrl }));
        await waitFor('inspect page', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return body.title === 'grim-inspect' ? body : null;
        }, 15000);

        ws.send(JSON.stringify({ type: 'inspect', x: 30, y: 20 }));
        const textHit = await nextControl('inspect');
        if (!String(textHit.text || '').includes('hello clipboard')) {
            throw new Error('inspect missed the text: ' + JSON.stringify(textHit));
        }
        ws.send(JSON.stringify({ type: 'inspect', x: 30, y: 100 }));
        const imageHit = await nextControl('inspect');
        if (!String(imageHit.src || '').endsWith('/dot.gif')) {
            throw new Error('inspect missed the image: ' + JSON.stringify(imageHit));
        }
        const imageRes = await fetch(base + '/sessions/' + session.id + '/resource?t=' + session.viewerToken + '&url=' + encodeURIComponent(imageHit.src));
        const imageBytes = Buffer.from(await imageRes.arrayBuffer());
        if (imageRes.status !== 200 || imageBytes[0] !== 0x47) {
            throw new Error('image resource ' + imageRes.status + ' ' + imageBytes.slice(0, 12).toString());
        }

        ws.send(JSON.stringify({ type: 'mouse', kind: 'move', x: 12, y: 20 }));
        ws.send(JSON.stringify({ type: 'mouse', kind: 'down', x: 12, y: 20, button: 'left' }));
        for (let x = 20; x <= 168; x += 8) {
            ws.send(JSON.stringify({ type: 'mouse', kind: 'move', x: x, y: 20 }));
        }
        ws.send(JSON.stringify({ type: 'mouse', kind: 'up', x: 168, y: 20, button: 'left' }));
        ws.send(JSON.stringify({ type: 'inspect', x: 80, y: 20 }));
        const afterDrag = await nextControl('inspect');
        ws.send(JSON.stringify({ type: 'copy' }));
        const copied = await nextControl('clipboard');
        if (!String(copied.text || afterDrag.selection || '').includes('hello')) {
            const errors = controls.filter((msg) => msg.type === 'error').map((msg) => msg.message);
            throw new Error('copy missed the selection: ' + JSON.stringify({ copied, afterDrag, errors }));
        }

        ws.send(JSON.stringify({ type: 'mouse', kind: 'down', x: 40, y: 236, button: 'left' }));
        ws.send(JSON.stringify({ type: 'mouse', kind: 'up', x: 40, y: 236, button: 'left' }));
        await sleep(100);
        ws.send(JSON.stringify({ type: 'paste', text: 'ZZ' }));
        await sleep(150);
        ws.send(JSON.stringify({ type: 'key', kind: 'down', key: 'q', text: 'q' }));
        await sleep(120);
        ws.send(JSON.stringify({ type: 'key', kind: 'down', key: 'ArrowLeft' }));
        ws.send(JSON.stringify({ type: 'key', kind: 'up', key: 'ArrowLeft' }));
        await sleep(80);
        ws.send(JSON.stringify({ type: 'key', kind: 'down', key: 'Backspace' }));
        ws.send(JSON.stringify({ type: 'key', kind: 'up', key: 'Backspace' }));
        await sleep(150);
        ws.send(JSON.stringify({ type: 'inspect', x: 40, y: 236 }));
        const pasted = await nextControl('inspect');
        if (!String(pasted.text || pasted.selection || '').includes('Zq')) {
            throw new Error('arrow or backspace did not edit: ' + JSON.stringify(pasted));
        }

        ws.send(JSON.stringify({ type: 'navigate', url: 'file:///etc/passwd' }));
        ws.send(JSON.stringify({ type: 'navigate', url: 'javascript:alert(1)' }));
        await sleep(400);
        const stayed = await fetch(base + '/sessions/' + session.id, {
            headers: { Authorization: 'Bearer ' + TOKEN }
        });
        const stayedBody = await stayed.json();
        if (!String(stayedBody.url || '').includes('/inspect')) {
            throw new Error('file or javascript url was allowed: ' + stayedBody.url);
        }

        ws.send(JSON.stringify({ type: 'mouse', kind: 'down', x: 40, y: 172, button: 'left' }));
        ws.send(JSON.stringify({ type: 'mouse', kind: 'up', x: 40, y: 172, button: 'left' }));
        const downloaded = await nextControl('download', 12000);
        const fileRes = await fetch(base + '/sessions/' + session.id + '/downloads/' + downloaded.id + '?t=' + session.viewerToken);
        const fileBytes = Buffer.from(await fileRes.arrayBuffer());
        if (fileRes.status !== 200 || fileBytes.toString() !== 'grim-bytes') {
            throw new Error('download bytes ' + fileRes.status + ' ' + fileBytes.toString());
        }

        ws.send(JSON.stringify({ type: 'navigate', url: 'chrome://version' }));
        await waitFor('chrome://version', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return String(body.url || '').startsWith('chrome://version') ? body : null;
        }, 20000);

        ws.send(JSON.stringify({ type: 'navigate', url: 'chrome://chrome-urls' }));
        await waitFor('chrome://chrome-urls', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return String(body.url || '').startsWith('chrome://chrome-urls') ? body : null;
        }, 20000);
        let chromeLink = null;
        const chromeWant = /^chrome:\/\/(version|gpu|credits|flags|settings|history|downloads|extensions)(\/|$)/i;
        for (let pass = 0; pass < 8 && !chromeLink; pass++) {
            for (let y = 40; y < 560 && !chromeLink; y += 18) {
                ws.send(JSON.stringify({ type: 'inspect', x: 48, y: y }));
                const hit = await nextControl('inspect', 4000);
                const href = String(hit.href || '');
                if (chromeWant.test(href)) chromeLink = { href, y };
            }
            if (!chromeLink) {
                ws.send(JSON.stringify({ type: 'wheel', deltaX: 0, deltaY: 400 }));
                await sleep(150);
            }
        }
        if (!chromeLink) throw new Error('chrome://chrome-urls had no link to click');
        ws.send(JSON.stringify({ type: 'mouse', kind: 'down', x: 48, y: chromeLink.y, button: 'left' }));
        ws.send(JSON.stringify({ type: 'mouse', kind: 'up', x: 48, y: chromeLink.y, button: 'left' }));
        await waitFor('chrome link ' + chromeLink.href, async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            const url = String(body.url || '');
            return chromeWant.test(url) ? body : null;
        }, 15000);

        const stallUrl = 'http://127.0.0.1:' + pagePort + '/stall';
        const reportMark = controls.length;
        ws.send(JSON.stringify({ type: 'navigate', url: stallUrl }));
        await sleep(200);
        ws.send(JSON.stringify({ type: 'navigate', url: localUrl }));
        await waitFor('interrupt stall', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return body.title === 'grim-local' ? body : null;
        }, 8000);
        const interrupted = controls.slice(reportMark).some((msg) => {
            const reported = String(msg.url || '');
            return (msg.type === 'navigating' || msg.type === 'location')
                && reported.indexOf('127.0.0.1:' + pagePort) !== -1
                && reported.indexOf('/stall') === -1;
        });
        if (!interrupted) throw new Error('navigation did not report a URL update');

        ws.send(JSON.stringify({ type: 'navigate', url: 'https://example.com/' }));
        await waitFor('example.com', async () => {
            const res = await fetch(base + '/sessions/' + session.id, {
                headers: { Authorization: 'Bearer ' + TOKEN }
            });
            const body = await res.json();
            return body.title === 'Example Domain' ? body : null;
        }, 20000);

        const late = await fetch(base + '/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + TOKEN
            },
            body: JSON.stringify({ url: localUrl, width: 800, height: 600 })
        });
        const lateSession = await late.json();
        if (late.status !== 201) throw new Error('late session ' + late.status);
        await sleep(2000);
        const lateWs = new WebSocket('ws://127.0.0.1:' + servicePort + '/sessions/' + lateSession.id + '/stream?t=' + lateSession.viewerToken);
        let lateJpeg = false;
        lateWs.on('message', (data, isBinary) => {
            if (!isBinary) return;
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) lateJpeg = true;
        });
        await new Promise((resolve, reject) => {
            lateWs.once('open', resolve);
            lateWs.once('error', reject);
        });
        await waitFor('late viewer frame', async () => lateJpeg || null, 5000);
        lateWs.close();
        await fetch(base + '/sessions/' + lateSession.id, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + TOKEN }
        });

        ws.send(JSON.stringify({ type: 'navigate', url: 'http://127.0.0.1:' + pagePort + '/tick' }));
        await sleep(700);
        function countFrames(ms) {
            return new Promise((resolve) => {
                let n = 0;
                const onMsg = (data, isBinary) => {
                    if (isBinary) {
                        n += 1;
                        return;
                    }
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'regions') n += 1;
                    } catch (_) {}
                };
                ws.on('message', onMsg);
                setTimeout(() => {
                    ws.off('message', onMsg);
                    resolve(n);
                }, ms);
            });
        }
        ws.send(JSON.stringify({ type: 'rtt', ms: 500 }));
        await sleep(300);
        const slowFrames = await countFrames(1500);
        ws.send(JSON.stringify({ type: 'rtt', ms: 16 }));
        await sleep(200);
        const fastFrames = await countFrames(1000);
        if (slowFrames < 8) throw new Error('refresh dropped below the floor: ' + slowFrames);
        if (slowFrames > 22) throw new Error('high rtt still sent ' + slowFrames + ' frames');
        if (fastFrames < 12 || fastFrames <= slowFrames) {
            throw new Error('fps did not follow rtt: slow ' + slowFrames + ' fast ' + fastFrames);
        }

        ws.send(JSON.stringify({ type: 'navigate', url: 'http://127.0.0.1:' + pagePort + '/pop' }));
        await sleep(800);
        let popupUrl = '';
        const onPopup = (data, isBinary) => {
            if (isBinary) return;
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'popup' && msg.url) popupUrl = msg.url;
            } catch (_) {}
        };
        ws.on('message', onPopup);
        ws.send(JSON.stringify({ type: 'mouse', kind: 'down', x: 30, y: 30, button: 'left' }));
        ws.send(JSON.stringify({ type: 'mouse', kind: 'up', x: 30, y: 30, button: 'left' }));
        await waitFor('popup window', async () => (popupUrl.includes('/opened') ? popupUrl : null), 6000);
        ws.off('message', onPopup);

        process.env.GRIMOIRE_BROWSER_ORIGIN = base;
        process.env.GRIMOIRE_BROWSER_TOKEN = TOKEN;
        const bridge = express();
        bridge.use(express.json());
        mountGrimoireBrowserBridge(bridge, (req, res, next) => next());
        const bridgeServer = await new Promise((resolve, reject) => {
            const server = bridge.listen(0, '127.0.0.1', () => resolve(server));
            server.once('error', reject);
        });
        const bridgePort = bridgeServer.address().port;
        const bridged = await fetch('http://127.0.0.1:' + bridgePort + '/api/grimoire-browser/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://example.com/' })
        });
        const bridgedBody = await bridged.json();
        if (bridged.status !== 201) throw new Error('bridge create failed ' + bridged.status + ' ' + JSON.stringify(bridgedBody));
        if (!String(bridgedBody.viewUrl || '').startsWith('/api/grimoire-browser/view/')) {
            throw new Error('viewUrl is not a same-origin path: ' + bridgedBody.viewUrl);
        }
        if (String(bridgedBody.viewUrl).includes(String(servicePort))) {
            throw new Error('viewUrl still points at the browser service port');
        }
        if (bridgedBody.viewUrl.includes(TOKEN)) throw new Error('admin token leaked through the bridge');
        const viewPage = await fetch('http://127.0.0.1:' + bridgePort + bridgedBody.viewUrl);
        const viewHtml = await viewPage.text();
        if (viewPage.status !== 200 || !viewHtml.includes('/api/grimoire-browser/sessions/')) {
            throw new Error('proxied viewer missing same-origin stream (' + viewPage.status + ')');
        }
        const frameRes = await fetch('http://127.0.0.1:' + bridgePort + '/api/grimoire-browser/sessions/' + bridgedBody.sessionId + '/frames' + new URL(bridgedBody.viewUrl, 'http://127.0.0.1').search);
        if (!frameRes.ok || !frameRes.body) throw new Error('frames stream ' + frameRes.status);
        const reader = frameRes.body.getReader();
        const decoder = new TextDecoder();
        let framed = '';
        const frameDeadline = Date.now() + 15000;
        while (!framed.includes('"type":"frame"') && Date.now() < frameDeadline) {
            const chunk = await reader.read();
            if (chunk.done) break;
            framed += decoder.decode(chunk.value, { stream: true });
        }
        reader.cancel().catch(() => {});
        if (!framed.includes('"type":"frame"')) throw new Error('same-origin stream sent no frame');

        const statusRes = await fetch('http://127.0.0.1:' + bridgePort + '/api/grimoire-browser/status');
        const statusBody = await statusRes.json();
        if (!statusBody.enabled || statusBody.origin !== base) {
            throw new Error('status did not point at the remote service: ' + JSON.stringify(statusBody));
        }
        if (JSON.stringify(statusBody).includes(TOKEN)) throw new Error('status leaked the token');

        await fetch('http://127.0.0.1:' + bridgePort + '/api/grimoire-browser/sessions/' + bridgedBody.sessionId, {
            method: 'DELETE'
        });
        ws.close();
        await fetch(base + '/sessions/' + session.id, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + TOKEN }
        });
        await new Promise((resolve) => bridgeServer.close(resolve));

        console.log('grimoire browser ok');
        console.log('  chrome session streamed a JPEG, click changed the title, example.com loaded');
        console.log('  iframe path:', bridgedBody.viewUrl.split('?')[0]);
    } finally {
        await killChild(browser);
        await new Promise((resolve) => page.close(resolve));
        if (browser.exitCode && browser.exitCode !== 0 && !log.includes('listening on')) {
            console.error(log);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
