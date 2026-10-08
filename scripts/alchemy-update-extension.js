#!/usr/bin/env node
'use strict';

/**
 * Download Chrome Web Store extensions for Alchemy (services/grimoire-browser) and unpack them.
 *
 *   node scripts/alchemy-update-extension.js [extensionId ...]
 *
 * No ids: 1Password (aeblfdkhhhdcdjpifhhbdiojplfjncoa).
 * Output: $ALCHEMY_EXTENSIONS_DIR (default ~/.local/share/dreamscape/alchemy-extensions)/<id>/
 * Unpacked extensions never auto-update: re-run this script to update, then restart Alchemy.
 * The Web Store public key is written into manifest.json "key" so the unpacked id matches the store id.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_IDS = ['aeblfdkhhhdcdjpifhhbdiojplfjncoa'];
const OUT_DIR = process.env.ALCHEMY_EXTENSIONS_DIR || path.join(os.homedir(), '.local', 'share', 'dreamscape', 'alchemy-extensions');

function chromeVersion() {
    for (const bin of [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome-stable'].filter(Boolean)) {
        const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
        const match = String(result.stdout || '').match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match) return match[1];
    }
    return '130.0.0.0';
}

// Minimal protobuf reader: returns [fieldNumber, bytes] for length-delimited fields.
function protoFields(buf) {
    const out = [];
    let pos = 0;
    const varint = () => {
        let value = 0;
        let shift = 0;
        for (;;) {
            const byte = buf[pos++];
            value += (byte & 0x7f) * Math.pow(2, shift);
            if (!(byte & 0x80)) return value;
            shift += 7;
        }
    };
    while (pos < buf.length) {
        const tag = varint();
        const wire = tag % 8;
        const field = Math.floor(tag / 8);
        if (wire === 2) {
            const len = varint();
            out.push([field, buf.subarray(pos, pos + len)]);
            pos += len;
        } else if (wire === 0) varint();
        else if (wire === 1) pos += 8;
        else if (wire === 5) pos += 4;
        else throw new Error('unsupported protobuf wire type ' + wire);
    }
    return out;
}

// CRX3: "Cr24", version 3, header length, CrxFileHeader, zip.
function parseCrx(buf, id) {
    if (buf.toString('latin1', 0, 4) !== 'Cr24' || buf.readUInt32LE(4) !== 3) throw new Error(id + ': not a CRX3 file');
    const headerLen = buf.readUInt32LE(8);
    const header = buf.subarray(12, 12 + headerLen);
    const fields = protoFields(header);
    const signed = fields.find(([field]) => field === 10000);
    const crxId = signed && (protoFields(signed[1]).find(([field]) => field === 1) || [])[1];
    let key = null;
    for (const [field, proof] of fields) {
        if (field !== 2 && field !== 3) continue;
        const publicKey = (protoFields(proof).find(([f]) => f === 1) || [])[1];
        if (publicKey && crxId && crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16).equals(crxId)) key = publicKey;
    }
    if (!key) throw new Error(id + ': no public key matches the CRX id');
    return { key: key.toString('base64'), zip: buf.subarray(12 + headerLen) };
}

function extensionIdFromKey(base64) {
    const hex = crypto.createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex').slice(0, 32);
    return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

async function update(id) {
    if (!/^[a-p]{32}$/.test(id)) throw new Error(id + ': not an extension id');
    const url = 'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3&prodversion='
        + chromeVersion() + '&x=' + encodeURIComponent('id=' + id + '&uc');
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(id + ': download failed ' + res.status);
    const { key, zip } = parseCrx(Buffer.from(await res.arrayBuffer()), id);
    if (extensionIdFromKey(key) !== id) throw new Error(id + ': key does not hash to this id');

    fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
    const work = fs.mkdtempSync(path.join(OUT_DIR, '.' + id + '-'));
    const zipPath = path.join(work, 'ext.zip');
    const unpacked = path.join(work, 'unpacked');
    fs.writeFileSync(zipPath, zip);
    const unzip = spawnSync('unzip', ['-q', '-o', zipPath, '-d', unpacked], { encoding: 'utf8' });
    if (unzip.status !== 0 && unzip.status !== 1) throw new Error(id + ': unzip failed ' + (unzip.stderr || unzip.status));
    // Chrome refuses to load an unpacked extension that ships the store's reserved _metadata folder.
    fs.rmSync(path.join(unpacked, '_metadata'), { recursive: true, force: true });
    const manifestPath = path.join(unpacked, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.key = key;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const target = path.join(OUT_DIR, id);
    const old = path.join(work, 'old');
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(unpacked, target);
    fs.rmSync(work, { recursive: true, force: true });
    console.log(id + ' ' + manifest.version + ' -> ' + target);
}

(async () => {
    const ids = process.argv.slice(2);
    let failed = false;
    for (const id of ids.length ? ids : DEFAULT_IDS) {
        try {
            await update(id);
        } catch (err) {
            failed = true;
            console.error(err.message || err);
        }
    }
    if (failed) process.exit(1);
    console.log('Restart Alchemy to load the new version.');
})();
