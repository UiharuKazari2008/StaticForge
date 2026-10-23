/**
 * Programs in the VFS (Yozora #633, #638, #640): a .msaz or a Melaton app EXE runs, and a file an
 * installed Melaton app opens (its manifest's opens[], e.g. SoraTan.exe in SoraTan.iso) starts that
 * app, instead of downloading. explorerApplet.js openItem and explorerArchive.js openEntry ask
 * vfsPrograms.open(item) first; it returns true when it took the item (started it, or said why it
 * could not). A Melaton app EXE carries its package appended to a Windows stub (#640), so the server
 * recognises it by content; the client offers any .exe to the launcher and downloads it only if the
 * server says it is not a Melaton app (APP_NO_OPENER).
 *
 * The apps themselves: public/scripts/comp/melatonApps.js (client) and modules/melatonApps/ (server).
 */
(function (root) {
    function specOf(item) {
        if (!item || item.kind === 'folder') return null;
        if (item.targetKind === 'archive-entry' && item.archiveFileId) {
            return { archiveFileId: item.archiveFileId, entryPath: item.archiveEntryPath || item.targetId };
        }
        if (item.targetKind === 'user-file' && item.targetId) return { fileId: item.targetId };
        return null;
    }

    function itemSize(item) {
        const n = Number(item && (item.sizeBytes != null ? item.sizeBytes : item.size));
        return Number.isFinite(n) ? n : null;
    }

    const isMsaz = (item) => /\.msaz$/i.test(String(item && item.name || ''));
    const isExe = (item) => /\.exe$/i.test(String(item && item.name || ''));

    function message(item, text) {
        if (typeof root.showConfirmationDialog !== 'function') return;
        root.showConfirmationDialog(text, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, {
            title: item.name || 'Melaton',
            icon: 'fas fa-circle-xmark',
            showCloseButton: true
        });
    }

    async function open(item) {
        const spec = specOf(item);
        if (!spec || !root.melatonApps) return false;
        // A .msaz and a Melaton app EXE are launched and let the server decide (an exe might be an
        // ordinary Windows program: the server answers APP_NO_OPENER and Explorer downloads it).
        // Any other file only launches when an installed app lists it in opens[].
        if (!isMsaz(item) && !isExe(item)) {
            const opener = await root.melatonApps.openerFor(item.name, itemSize(item));
            if (!opener) return false;
        }
        try {
            await root.melatonApps.launch(spec);
        } catch (err) {
            const code = root.melatonApps.errorCode ? root.melatonApps.errorCode(err) : (err && err.details);
            if (isExe(item) && !isMsaz(item) && code === 'APP_NO_OPENER') return false; // a normal Windows exe: download it
            // a client-side start failure already showed "<app> has stopped working"
            if (!err || !err.melatonAppFault) message(item, err && err.message ? err.message : `${item.name} could not start.`);
        }
        return true;
    }

    root.vfsPrograms = { open, specOf };
})(window);
