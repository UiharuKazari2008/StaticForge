/**
 * Programs in the VFS: a user file (or an archive entry, explorerArchive.js) that is a Windows
 * program the desktop has a port of opens that port instead of downloading (Yozora #633).
 *
 * A program is known by its file name and exact size, so a renamed or different build still
 * downloads. explorerApplet.js openItem and explorerArchive.js openEntry ask vfsPrograms.open(item)
 * first; it returns true when it started something.
 */
(function (root) {
    const PROGRAMS = [
        {
            // SoraTan.exe, Nanami's desktop toy (SoraTan.iso, 2009 build): desktop-apps/soraTan.js
            name: 'soratan.exe',
            size: 999424,
            feature: 'soratan',
            launch: () => root.openSoraTan()
        }
    ];

    function itemSize(item) {
        const n = Number(item && (item.sizeBytes != null ? item.sizeBytes : item.size));
        return Number.isFinite(n) ? n : null;
    }

    function find(item) {
        if (!item || item.kind === 'folder') return null;
        const name = String(item.name || '').toLowerCase();
        const size = itemSize(item);
        return PROGRAMS.find((p) => p.name === name && p.size === size) || null;
    }

    async function open(item) {
        const program = find(item);
        if (!program) return false;
        try {
            if (program.feature && root.featureLoader) await root.featureLoader.loadFeature(program.feature);
            await program.launch();
        } catch (err) {
            console.error(`vfsPrograms: ${item.name} did not start`, err);
        }
        return true;
    }

    root.vfsPrograms = { find, open };
})(window);
