#!/usr/bin/env node
/**
 * Encode text to T5 token ids, or decode ids back to text.
 *
 *   node scripts/prompt-list-codec.js enc -- your phrase here
 *   node scripts/prompt-list-codec.js dec -- 12,34,56
 *   node scripts/prompt-list-codec.js dec -- 12 34 56
 */
'use strict';

const fs = require('fs');
const path = require('path');
const T5Tokenizer = require('../modules/t5-tokenizer-standalone');

const EOS = 1;
let tok = null;

function tokenizer() {
    if (tok) return tok;
    const jsonPath = path.join(__dirname, '../public/protected/t5_tokenizer.json');
    const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const next = new T5Tokenizer();
    next.loadFromJSON(config);
    tok = next;
    return tok;
}

function encodeIds(text) {
    const ids = tokenizer().encode(String(text || ''));
    if (ids.length && ids[ids.length - 1] === EOS) ids.pop();
    return ids;
}

function decodeIds(ids) {
    const clean = (ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
    return tokenizer().decode(clean, true).replace(/\s+/g, ' ').trim();
}

function parseIds(argv) {
    const out = [];
    argv.forEach((part) => {
        String(part).split(/[,\s]+/).forEach((bit) => {
            if (!bit) return;
            const n = Number(bit);
            if (Number.isFinite(n)) out.push(n);
        });
    });
    return out;
}

if (require.main === module) {
    const cmd = process.argv[2];
    const args = process.argv.slice(3).filter((a) => a !== '--');
    if (cmd === 'enc') {
        const text = args.join(' ');
        const ids = encodeIds(text);
        const back = decodeIds(ids);
        console.log(ids.join(','));
        if (back.toLowerCase() !== text.trim().toLowerCase().replace(/\s+/g, ' ')) {
            console.error('roundtrip: ' + back);
            process.exitCode = 2;
        }
    } else if (cmd === 'dec') {
        console.log(decodeIds(parseIds(args)));
    } else {
        console.error('usage: prompt-list-codec.js enc -- <text>');
        console.error('       prompt-list-codec.js dec -- <ids>');
        process.exitCode = 1;
    }
}

module.exports = { encodeIds, decodeIds, tokenizer };
