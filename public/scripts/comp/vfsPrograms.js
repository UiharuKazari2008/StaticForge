/**
 * Programs in the VFS (Yozora #633, #638): a .msaz runs, and a file an installed Melaton app opens
 * (its manifest's opens[], e.g. SoraTan.exe in SoraTan.iso) starts that app, instead of
 * downloading. explorerApplet.js openItem and explorerArchive.js openEntry ask vfsPrograms.open(item)
 * first; it returns true when it took the item (started it, or said why it could not).
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
        if (!isMsaz(item)) {
            const opener = await root.melatonApps.openerFor(item.name, itemSize(item));
            if (!opener) return false;
        }
        try {
            await root.melatonApps.launch(spec);
        } catch (err) {
            // a client-side start failure already showed "<app> has stopped working"
            if (!err || !err.melatonAppFault) message(item, err && err.message ? err.message : `${item.name} could not start.`);
        }
        return true;
    }

    root.vfsPrograms = { open, specOf };
})(window);
