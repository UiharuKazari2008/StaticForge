/**
 * Serve cursor packs from public/cursors/{vista,posy}.
 * Vista is committed and listed in the install manifest. Posy stays host-local
 * and is listed only when those files are on disk. Missing files are the keyword only.
 */
const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');

const PACK_DIR = path.join('public', 'cursors');
const SCHEME_IDS = ['vista', 'posy'];
const ALLOWED_EXT = new Set(['.cur', '.ani', '.png', '.svg', '.ico']);

const KEYWORDS = [
    'auto',
    'default',
    'none',
    'context-menu',
    'help',
    'pointer',
    'progress',
    'wait',
    'cell',
    'crosshair',
    'text',
    'vertical-text',
    'alias',
    'copy',
    'move',
    'no-drop',
    'not-allowed',
    'grab',
    'grabbing',
    'all-scroll',
    'col-resize',
    'row-resize',
    'n-resize',
    'e-resize',
    's-resize',
    'w-resize',
    'ne-resize',
    'nw-resize',
    'se-resize',
    'sw-resize',
    'ew-resize',
    'ns-resize',
    'nesw-resize',
    'nwse-resize',
    'zoom-in',
    'zoom-out'
];

const ROLE = {
    auto: 'arrow',
    default: 'arrow',
    'context-menu': 'arrow',
    cell: 'arrow',
    pointer: 'link',
    help: 'help',
    wait: 'busy',
    progress: 'work',
    text: 'text',
    'vertical-text': 'text',
    crosshair: 'precision',
    'not-allowed': 'unavail',
    'no-drop': 'unavail',
    move: 'move',
    grab: 'move',
    grabbing: 'move',
    'all-scroll': 'move',
    'ew-resize': 'ew',
    'e-resize': 'ew',
    'w-resize': 'ew',
    'col-resize': 'ew',
    'ns-resize': 'ns',
    'n-resize': 'ns',
    's-resize': 'ns',
    'row-resize': 'ns',
    'nwse-resize': 'nwse',
    'nw-resize': 'nwse',
    'se-resize': 'nwse',
    'nesw-resize': 'nesw',
    'ne-resize': 'nesw',
    'sw-resize': 'nesw',
    alias: 'alt',
    copy: 'alt',
    'zoom-in': 'zoomin',
    'zoom-out': 'zoomout'
};

const FILES = {
    vista: {
        arrow: { file: 'aero_arrow.cur', hotspot: '0 0' },
        link: { file: 'aero_link.cur', hotspot: '8 0' },
        help: { file: 'aero_helpsel.cur', hotspot: '0 0' },
        busy: { file: 'aero_busy.ani', hotspot: '16 16' },
        work: { file: 'aero_working.ani', hotspot: '0 0' },
        text: { file: 'beam_r.cur', hotspot: '4 8' },
        precision: { file: 'cross.cur', hotspot: '16 16' },
        unavail: { file: 'aero_unavail.cur', hotspot: '8 8' },
        move: { file: 'aero_move.cur', hotspot: '11 11' },
        ew: { file: 'aero_ew.cur', hotspot: '16 16' },
        ns: { file: 'aero_ns.cur', hotspot: '16 16' },
        nwse: { file: 'aero_nwse.cur', hotspot: '16 16' },
        nesw: { file: 'aero_nesw.cur', hotspot: '16 16' },
        alt: { file: 'aero_arrow.cur', hotspot: '0 0' },
        zoomin: { file: 'aero_link.cur', hotspot: '8 0' },
        zoomout: { file: 'aero_link.cur', hotspot: '8 0' }
    },
    posy: {
        arrow: { file: 'pointer.cur', hotspot: '0 0' },
        link: { file: 'link.cur', hotspot: '8 0' },
        help: { file: 'help.cur', hotspot: '0 0' },
        busy: { file: 'busy.ani', hotspot: '16 16' },
        work: { file: 'working.ani', hotspot: '0 0' },
        text: { file: 'beam.cur', hotspot: '4 8' },
        precision: { file: 'precise.cur', hotspot: '16 16' },
        unavail: { file: 'unavailable.cur', hotspot: '8 8' },
        move: { file: 'move.cur', hotspot: '11 11' },
        ew: { file: 'horizontal.cur', hotspot: '16 16' },
        ns: { file: 'vertical.cur', hotspot: '16 16' },
        nwse: { file: 'diagonal_1.cur', hotspot: '16 16' },
        nesw: { file: 'diagonal_2.cur', hotspot: '16 16' },
        alt: { file: 'alternate.cur', hotspot: '0 0' },
        zoomin: { file: 'zoom-in.cur', hotspot: '8 8' },
        zoomout: { file: 'zoom-out.cur', hotspot: '8 8' }
    }
};

function schemeValue(scheme, keyword) {
    if (keyword === 'none') return 'none';
    const files = FILES[scheme];
    if (!files) return keyword;
    const role = ROLE[keyword] || 'arrow';
    const spec = files[role] || files.arrow;
    const full = resolveCursorPath(PROJECT_ROOT, scheme, spec.file);
    if (full && fs.existsSync(full)) {
        return `url("/cursors/${scheme}/${spec.file}") ${spec.hotspot}, ${keyword}`;
    }
    return keyword;
}

function classicVarsBlock() {
    return KEYWORDS.map((k) => `    --c-${k}: ${k};`).join('\n');
}

function schemeVarsBlock(scheme) {
    return KEYWORDS.map((k) => `    --c-${k}: ${schemeValue(scheme, k)};`).join('\n');
}

function buildCss() {
    return [
        '/* Pointer scheme tokens. Classic = native keywords. Vista / Posy = url() from',
        '   /cursors/{scheme}/ when the file is on disk (public/cursors/vista is committed;',
        '   Posy stays host-local). Missing files use the keyword only - never a 404 url().',
        '   desktopCursors.js sets the attr. */',
        'html {',
        classicVarsBlock(),
        '}',
        '',
        'html[data-cursor-scheme="vista"] {',
        schemeVarsBlock('vista'),
        '}',
        '',
        'html[data-cursor-scheme="posy"] {',
        schemeVarsBlock('posy'),
        '}',
        ''
    ].join('\n');
}

function decodeScheme(raw) {
    if (raw === 'vista' || raw === 'posy') return raw;
    return null;
}

function decodeCursorName(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let name = raw;
    try {
        name = decodeURIComponent(raw);
    } catch (_err) {
        return null;
    }
    if (name !== path.basename(name) || name.includes('\0') || name.includes('/') || name.includes('\\')) {
        return null;
    }
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return null;
    return name;
}

const FILE_ALIASES = {
    vista: {
        'aero_arrow.cur': ['arrow.cur'],
        'aero_link.cur': ['aero_link.ani', 'link.cur'],
        'aero_helpsel.cur': ['helpsel.cur', 'help.cur'],
        'aero_busy.ani': ['busy.ani', 'aero_busy.cur'],
        'aero_working.ani': ['working.ani', 'aero_working.cur'],
        'aero_text.cur': ['beam_r.cur', 'beam.cur', 'text.cur'],
        'aero_precision.cur': ['cross.cur', 'precision.cur', 'precise.cur'],
        'aero_unavail.cur': ['unavail.cur', 'unavailable.cur'],
        'aero_move.cur': ['move.cur', 'sizeall.cur'],
        'aero_ew.cur': ['ew.cur', 'horizontal.cur'],
        'aero_ns.cur': ['ns.cur', 'vertical.cur'],
        'aero_nwse.cur': ['nwse.cur', 'diagonal_1.cur'],
        'aero_nesw.cur': ['nesw.cur', 'diagonal_2.cur']
    },
    posy: {
        'pointer.cur': ['Posy Default.cur', 'Posy Cursor.cur', 'Cursor.cur', 'default.cur'],
        'link.cur': ['Posy Link.cur', 'Cursor_link.cur', 'hand2.cur'],
        'help.cur': ['Posy Help.cur', 'Cursor_helpsel.cur'],
        'busy.ani': ['Posy Busy.ani', 'Cursor_busy.ani', 'busy.cur'],
        'working.ani': ['Posy Working.ani', 'Cursor_working.ani', 'working.cur'],
        'beam.cur': ['Posy Beam.cur', 'Posy Text.cur', 'Cursor_text.cur'],
        'precise.cur': ['Posy Precise.cur', 'Cursor_precision.cur'],
        'unavailable.cur': ['Posy Unavailable.cur', 'Cursor_unavail.cur'],
        'move.cur': ['Posy Move.cur', 'Cursor_move.cur'],
        'horizontal.cur': ['Posy Horizontal.cur', 'Posy EW.cur'],
        'vertical.cur': ['Posy Vertical.cur', 'Posy NS.cur'],
        'diagonal_1.cur': ['Posy Diagonal 1.cur', 'Posy NWSE.cur'],
        'diagonal_2.cur': ['Posy Diagonal 2.cur', 'Posy NESW.cur'],
        'alternate.cur': ['Posy Alternate.cur'],
        'zoom-in.cur': ['Posy Zoom In.cur'],
        'zoom-out.cur': ['Posy Zoom Out.cur']
    }
};

function safePackFile(packRoot, name) {
    const decoded = decodeCursorName(name);
    if (!decoded) return null;
    const full = path.resolve(packRoot, decoded);
    if (full !== path.join(packRoot, decoded)) return null;
    return full;
}

function resolveCursorPath(projectRoot, scheme, filename) {
    const sid = decodeScheme(scheme);
    const name = decodeCursorName(filename);
    if (!sid || !name) return null;
    const roots = [path.resolve(projectRoot, PACK_DIR, sid)];
    const aliases = FILE_ALIASES[sid] && FILE_ALIASES[sid][name] ? FILE_ALIASES[sid][name] : [];
    const stem = name.replace(/\.(cur|ani|png|svg|ico)$/i, '');
    const extra = [stem + '.png', stem + '.cur'];
    const candidates = [name].concat(aliases, extra);
    for (let r = 0; r < roots.length; r++) {
        for (let i = 0; i < candidates.length; i++) {
            const full = safePackFile(roots[r], candidates[i]);
            if (full && fs.existsSync(full)) return full;
        }
    }
    return safePackFile(roots[0], name);
}

// Files the /cursors/{scheme}/{file} route can serve (public/cursors).
function listCursorPackFiles(projectRoot) {
    const root = projectRoot || PROJECT_ROOT;
    const out = [];
    const seen = new Set();
    for (let s = 0; s < SCHEME_IDS.length; s++) {
        const scheme = SCHEME_IDS[s];
        const dirs = [path.resolve(root, PACK_DIR, scheme)];
        for (let d = 0; d < dirs.length; d++) {
            let names;
            try {
                names = fs.readdirSync(dirs[d]);
            } catch (_err) {
                continue;
            }
            for (let i = 0; i < names.length; i++) {
                const decoded = decodeCursorName(names[i]);
                if (!decoded) continue;
                const abs = safePackFile(dirs[d], decoded);
                if (!abs) continue;
                let st;
                try {
                    st = fs.statSync(abs);
                } catch (_err) {
                    continue;
                }
                if (!st.isFile()) continue;
                const webPath = `/cursors/${scheme}/${decoded}`;
                if (seen.has(webPath)) continue;
                seen.add(webPath);
                out.push({ webPath, abs });
            }
        }
    }
    out.sort((a, b) => a.webPath.localeCompare(b.webPath));
    return out;
}

function contentTypeFor(name) {
    const ext = path.extname(name).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.ico') return 'image/x-icon';
    return 'application/octet-stream';
}

function sendCursor(req, res, projectRoot) {
    const full = resolveCursorPath(projectRoot, req.params && req.params.scheme, req.params && req.params.file);
    if (!full) {
        res.status(404).end();
        return false;
    }
    if (!fs.existsSync(full)) {
        res.status(404).end();
        return false;
    }
    res.setHeader('Content-Type', contentTypeFor(full));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(full);
    return true;
}

module.exports = {
    PACK_DIR,
    SCHEME_IDS,
    KEYWORDS,
    ROLE,
    FILES,
    schemeValue,
    buildCss,
    decodeScheme,
    decodeCursorName,
    FILE_ALIASES,
    resolveCursorPath,
    listCursorPackFiles,
    sendCursor
};
