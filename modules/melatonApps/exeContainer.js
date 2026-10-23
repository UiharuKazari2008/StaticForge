/**
 * Melaton app EXE container (Yozora #640): a Melaton app package carried inside a real Windows
 * program, so the one file runs on a normal PC (showing "This application can only run on Melaton
 * OS.") and holds the app that Melaton OS runs.
 *
 *   [ PE32 stub (modules/melatonApps/stub/melaton-stub.exe) ][ the .msaz zip ]
 *
 * The stub is a real compiled program (apps/_stub/MelatonStub.cs, built on the Vista VM); this
 * module never generates executable code. It only joins the two and reads them back:
 *
 *   wrapPackageExe(stub, zip)   -> Buffer   the stub followed by the package zip
 *   exeOverlayOffset(buf)       -> number   where the zip begins (end of the PE), or -1 if not a PE
 *   packageZipFromExe(buf)      -> Buffer   the appended zip, a standalone zip from its first byte
 *   isMelatonExe(buf)           -> boolean  a PE whose overlay is a zip holding manifest.json
 *   readExeHead(fdOrPath)       -> {overlay} or null   the overlay offset from the file head, no full read
 *
 * The package is appended whole, so the overlay bytes are a byte-identical standalone zip: the
 * package store reads it by slicing to the overlay (adm-zip reads the slice directly). 7-Zip and
 * other tools open the whole file through their self-extracting-archive handling (the PE is the
 * prefix). Nothing shifts the zip's internal offsets.
 */
'use strict';

const fs = require('fs');

const MZ = 0x5a4d;
const PE_SIG = 0x00004550;
const ZIP_LOCAL = 0x04034b50;
const ZIP_EOCD = 0x06054b50;

/**
 * End of the PE image on disk: the highest pointerToRawData + sizeOfRawData over the sections.
 * The section table is near the start, so this works from the file head alone; `requireComplete`
 * (the default) additionally insists the whole image is present in `buf`.
 */
function computeOverlay(buf, requireComplete) {
    if (!Buffer.isBuffer(buf) || buf.length < 0x40 || buf.readUInt16LE(0) !== MZ) return -1;
    const peAt = buf.readUInt32LE(0x3c);
    if (peAt < 0 || peAt + 24 > buf.length || buf.readUInt32LE(peAt) !== PE_SIG) return -1;
    const numSections = buf.readUInt16LE(peAt + 6);
    const optSize = buf.readUInt16LE(peAt + 20);
    const sectionsAt = peAt + 24 + optSize;
    let end = sectionsAt + numSections * 40;
    if (numSections < 1 || numSections > 96 || end > buf.length) return -1; // the table itself must be present
    for (let i = 0; i < numSections; i++) {
        const s = sectionsAt + i * 40;
        const rawSize = buf.readUInt32LE(s + 16);
        const rawPtr = buf.readUInt32LE(s + 20);
        if (rawPtr && rawPtr + rawSize > end) end = rawPtr + rawSize;
    }
    if (requireComplete && end > buf.length) return -1;
    return end;
}

function exeOverlayOffset(buf) {
    return computeOverlay(buf, true);
}

function packageZipFromExe(buf) {
    const overlay = exeOverlayOffset(buf);
    if (overlay < 0 || overlay + 4 > buf.length || buf.readUInt32LE(overlay) !== ZIP_LOCAL) return null;
    return buf.subarray(overlay);
}

function wrapPackageExe(stub, zip) {
    if (!Buffer.isBuffer(stub) || exeOverlayOffset(stub) !== stub.length) {
        throw new Error('stub is not a PE with no overlay of its own');
    }
    if (!Buffer.isBuffer(zip) || zip.readUInt32LE(0) !== ZIP_LOCAL) throw new Error('package is not a zip');
    return Buffer.concat([stub, zip]);
}

function isMelatonExe(buf) {
    const zip = packageZipFromExe(buf);
    if (!zip || zip.length < 22) return false;
    // the end-of-central-directory record, then manifest.json among the central-directory names
    const tail = zip.subarray(Math.max(0, zip.length - 0x10000));
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === ZIP_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) return false;
    return zip.includes(Buffer.from('manifest.json'));
}

/** Overlay offset from a file handle or path without reading the whole file. */
async function readExeHead(fdOrPath) {
    let fd = fdOrPath;
    let opened = false;
    if (typeof fdOrPath === 'string') { fd = await fs.promises.open(fdOrPath, 'r'); opened = true; }
    try {
        const head = Buffer.alloc(0x10000);
        const { bytesRead } = await fd.read(head, 0, head.length, 0);
        // the section table is in the head; the overlay itself may be far beyond it
        const overlay = computeOverlay(head.subarray(0, bytesRead), false);
        return overlay < 0 ? null : { overlay };
    } finally {
        if (opened) await fd.close();
    }
}

module.exports = {
    wrapPackageExe,
    packageZipFromExe,
    exeOverlayOffset,
    readExeHead,
    isMelatonExe
};
