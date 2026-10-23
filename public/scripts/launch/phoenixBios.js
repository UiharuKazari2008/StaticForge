/**
 * Phoenix BIOS on /launch (Yozora #611): the POST every desktop start opens with, the Setup
 * Utility behind F2, the Boot Menu behind ESC, and the boot-order rule that picks what starts
 * next. A text-mode screen (80 x 25 cells, the CGA palette) painted into a 640 x 480 canvas
 * with the VGA 8 x 16 glyphs in 8 x 19 cells (biosFont.js), the way PhoenixBIOS 4.0 Release 6
 * draws itself on a VMware guest (measured on the Vista VM over VNC, 2026-10-21):
 *
 *   row 0      cyan band, "PhoenixBIOS Setup Utility" centred in black
 *   row 1      blue band, the menu tabs; the open tab is black on grey, two cells of air each side
 *   rows 2-22  grey body in a black frame: items (blue labels, black values, the selected value
 *              white on black, a selected sub-menu line white) in cols 4 / 34, a help box from
 *              col 53 ("Item Specific Help", a rule, the text from col 55)
 *   rows 23-24 cyan key bar, keys in white, what they do in black
 *   popups     option lists white on blue with a black shadow; confirmations and General Help
 *              black on white; every popup is one cell of shadow to the right and below
 *
 * Settings live in localStorage melatonCmos. Most do nothing, as asked. The ones that do:
 *   Boot order               the first device that can boot is started: Hard Drive is Melaton when
 *                            it is installed, CD-ROM Drive is the installation media (Setup), and
 *                            Removable Devices / Network fail over to the next one like hardware
 *   No server                the POST's server probe failed (opts.serverDown): the Intel Boot
 *                            Agent gives up (E61 offline, E51 unreachable, E53 a wrong answer),
 *                            then "Operating System not found" until a key or the server reboots
 *   Boot-time Diagnostic     the text POST (memory count, drives) instead of the logo splash
 *   NumLock, passwords, ...  stored, never enforced: nothing here can lock a device out
 *
 * createBios(env, paint) is the controller; post() runs the POST and resolves with the device
 * to boot; handleKey() / handlePointer() drive it. Test: scripts/test-phoenix-bios.js.
 */
(function (root) {
    'use strict';

    const COLS = 80;
    const ROWS = 25;
    const CELL_W = 8;
    const CELL_H = 19;
    const CMOS_KEY = 'melatonCmos';

    // CGA attribute colours (index into PALETTE)
    const C = { black: 0, blue: 1, cyan: 3, grey: 7, dark: 8, white: 15 };
    const PALETTE = ['#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
        '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF'];

    const config = {
        splashMs: 1800,        // the logo POST: the Starting bar fills over this long
        splashHoldMs: 250,     // the full bar stays this long before the boot continues
        diagStepMs: 140,       // each line of the text POST
        diagMemoryMs: 900,     // the extended-memory count
        cdPromptMs: 5000,      // "Press any key to boot from CD or DVD..."
        pxeMs: 2600,           // the network boot agent's text before it gives up
        enteringMs: 400,       // "Entering SETUP..." stays this long before the utility opens
        // the Starting bar does not count up: it stands still and jumps when a POST step is done,
        // at least this long after the jump before it (uneven, like a real POST), so instant
        // work still reads as separate jumps
        barStepGapsMs: [340, 520, 220, 430, 290]
    };

    const KEYBAR = {
        page: [
            [['F1', 2], ['Help', 7], ['↑↓', 14], ['Select Item', 18], ['-/+', 32], ['Change Values', 39], ['F9', 59], ['Setup Defaults', 64]],
            [['Esc', 2], ['Exit', 7], ['↔', 14], ['Select Menu', 18], ['Enter', 32], ['Select ► Sub-Menu', 39], ['F10', 59], ['Save and Exit', 64]]
        ],
        exit: [
            [['F1', 2], ['Help', 7], ['↑↓', 14], ['Select Item', 18], ['-/+', 32], ['Change Values', 39], ['F9', 59], ['Setup Defaults', 64]],
            [['Esc', 2], ['Exit', 7], ['↔', 14], ['Select Menu', 18], ['Enter', 32], ['Execute Command', 39], ['F10', 59], ['Save and Exit', 64]]
        ]
    };

    const GENERAL_HELP = [
        'Setup changes system behavior by modifying the BIOS',
        'configuration. Selecting incorrect values may',
        'cause system boot failure; load Setup Default values to',
        'recover.',
        '',
        '<Up/Down> arrows select fields in current menu.',
        '<PgUp/PgDn> moves to previous/next page on scrollable menus.',
        '<Home/End> moves to top/bottom item of current menu.',
        '',
        'Within a field, <F5> or <-> selects next lower value and',
        '<F6>, <+>, or <Space> selects next higher value.',
        '',
        '<Enter> opens a sub-menu or the list of values for a field.',
        '<Esc> leaves a sub-menu, or opens the Exit menu.',
        '<F9> loads the default values for every field.',
        '<F10> saves the configuration and exits.',
        '',
        'The boot order on the Boot menu decides what starts: the',
        'Hard Drive is Xyridian Melaton once it is installed and',
        'the CD-ROM Drive is the Melaton installation media.'
    ];

    const DRIVE_HELP = ['User = you enter', 'parameters of hard-disk', 'drive installed at this', 'connection.', 'Auto = autotypes', 'hard-disk drive', 'installed here.', '1-39 = you select', 'pre-determined  type of', 'hard-disk drive', 'installed here.', 'CD-ROM = a CD-ROM drive', 'is installed here.', 'ATAPI Removable =', 'removable disk drive is', 'installed here.'];

    const ENABLED = ['Disabled', 'Enabled'];
    const CACHE_MODES = ['Disabled', 'Write Through', 'Write Protect', 'Write Back'];

    function opt(id, label, options, def, help, extra) {
        return Object.assign({ type: 'option', id, label, options, def, help: help || [] }, extra || {});
    }
    function sub(id, label, page, help, extra) {
        return Object.assign({ type: 'sub', id, label, page, help: help || [] }, extra || {});
    }
    function info(label, value, help) {
        return { type: 'info', label, value, help: help || [] };
    }
    const blank = { type: 'blank' };

    function driveSubmenu(id, title, present, facts) {
        return {
            id,
            title,
            items: present ? [
                opt(id + 'Type', 'Type:', ['Auto', 'User', 'CD-ROM', 'ATAPI Removable', 'None'], present === 'cdrom' ? 'CD-ROM' : 'Auto', DRIVE_HELP),
                info('Device:', title.split('  [')[0]),
                // the autotyped disk's size, from the storage estimate that lands during the POST
                ...(facts ? [{ type: 'info', label: 'Maximum Capacity:', get value() { return facts.capacity; }, help: [] }] : []),
                blank,
                opt(id + 'Multi', 'Multi-Sector Transfers:', ['Disabled', '2 Sectors', '4 Sectors', '8 Sectors', '16 Sectors'], present === 'cdrom' ? 'Disabled' : '16 Sectors', ['Any selection except', 'Disabled determines the', 'number of sectors', 'transferred per block.']),
                opt(id + 'Lba', 'LBA Mode Control:', ENABLED, present === 'cdrom' ? 'Disabled' : 'Enabled', ['Enabling LBA causes', 'Logical Block Addressing', 'to be used in place of', 'Cylinders, Heads &', 'Sectors.']),
                opt(id + '32', '32 Bit I/O:', ENABLED, 'Disabled', ['This setting enables or', 'disables 32 bit IDE data', 'transfers.']),
                opt(id + 'Pio', 'Transfer Mode:', ['Standard', 'Fast PIO 1', 'Fast PIO 2', 'Fast PIO 3', 'Fast PIO 4', 'FPIO 3 / DMA 1', 'FPIO 4 / DMA 2'], present === 'cdrom' ? 'Standard' : 'FPIO 4 / DMA 2', ['Selects the method for', 'moving data to/from the', 'drive. Autotype the', 'drive to select the', 'optimum transfer mode.']),
                opt(id + 'Udma', 'Ultra DMA Mode:', ['Disabled', 'Mode 0', 'Mode 1', 'Mode 2', 'Mode 3', 'Mode 4', 'Mode 5'], present === 'cdrom' ? 'Disabled' : 'Mode 5', ['Selects the Ultra DMA', 'mode used for moving', 'data to/from the drive.', 'Autotype the drive to', 'select the optimum', 'transfer mode.'])
            ] : [
                opt(id + 'Type', 'Type:', ['Auto', 'User', 'CD-ROM', 'ATAPI Removable', 'None'], 'Auto', DRIVE_HELP),
                info('Device:', title),
                blank,
                opt(id + 'Multi', 'Multi-Sector Transfers:', ['Disabled', '2 Sectors', '4 Sectors', '8 Sectors', '16 Sectors'], 'Disabled', [], { greyed: true }),
                opt(id + 'Lba', 'LBA Mode Control:', ENABLED, 'Disabled', [], { greyed: true }),
                opt(id + '32', '32 Bit I/O:', ENABLED, 'Disabled', ['This setting enables or', 'disables 32 bit IDE data', 'transfers.']),
                opt(id + 'Pio', 'Transfer Mode:', ['Standard', 'Fast PIO 1', 'Fast PIO 2', 'Fast PIO 3', 'Fast PIO 4'], 'Standard', [], { greyed: true }),
                opt(id + 'Udma', 'Ultra DMA Mode:', ['Disabled', 'Mode 0', 'Mode 1', 'Mode 2'], 'Disabled', [], { greyed: true })
            ]
        };
    }

    /** The whole utility, data first. facts = what the machine reports (memory, disk, media). */
    function buildPages(facts) {
        const cacheRanges = ['A000 - AFFF', 'B000 - BFFF', 'C800 - CBFF', 'CC00 - CFFF', 'D000 - D3FF', 'D400 - D7FF', 'D800 - DBFF', 'DC00 - DFFF', 'E000 - E3FF', 'E400 - E7FF', 'E800 - EBFF', 'EC00 - EFFF'];
        const BOOT_DEVICES = [
            { id: 'removable', label: 'Removable Devices', help: ['Keys used to view or', 'configure devices:', '<Enter> expands or', 'collapses devices with', 'a + or -', '<Ctrl+Enter> expands', 'all', '<+> and <-> moves the', 'device up or down.', '<n> May move removable', 'device between Hard', 'Disk or Removable Disk', '<d> Remove a device', 'that is not installed.'] },
            { id: 'hdd', label: 'Hard Drive', children: [facts.diskModel + '-(PM)', 'Bootable Add-in Cards'] },
            { id: 'cdrom', label: 'CD-ROM Drive' },
            { id: 'network', label: 'Network boot from Intel E1000' }
        ];
        return {
            tabs: ['main', 'advanced', 'security', 'boot', 'exit'],
            pages: {
                main: {
                    id: 'main', title: 'Main', items: [
                        { type: 'time', id: 'time', label: 'System Time:', help: ['<Tab>, <Shift-Tab>, or', '<Enter> selects field.'] },
                        { type: 'date', id: 'date', label: 'System Date:', help: ['<Tab>, <Shift-Tab>, or', '<Enter> selects field.'] },
                        blank,
                        opt('fdA', 'Legacy Diskette A:', ['Disabled', '360 KB  5¼"', '1.2 MB  5¼"', '720 KB  3½"', '1.44/1.25 MB 3½"', '2.88 MB  3½"'], 'Disabled', ['Selects floppy type.', 'Note that 1.25 MB 3½"', 'references a 1024 byte/', 'sector Japanese media', 'format. The 1.25 MB,', '3½" diskette requires', 'a 3-Mode floppy-disk', 'drive.']),
                        opt('fdB', 'Legacy Diskette B:', ['Disabled', '360 KB  5¼"', '1.2 MB  5¼"', '720 KB  3½"', '1.44/1.25 MB 3½"', '2.88 MB  3½"'], 'Disabled', ['Selects floppy type.', 'Note that 1.25 MB 3½"', 'references a 1024 byte/', 'sector Japanese media', 'format. The 1.25 MB,', '3½" diskette requires', 'a 3-Mode floppy-disk', 'drive.']),
                        blank,
                        sub('pm', 'Primary Master', 'pm', [], { value: () => `[${facts.diskModel}]` }),
                        sub('ps', 'Primary Slave', 'ps', [], { value: () => '[None]' }),
                        sub('sm', 'Secondary Master', 'sm', [], { value: () => `[${facts.cdModel}]` }),
                        sub('ss', 'Secondary Slave', 'ss', [], { value: () => '[None]' }),
                        blank,
                        sub('kb', 'Keyboard Features', 'kb', ['Select keyboard options']),
                        blank,
                        info('System Memory:', '640 KB'),
                        info('Extended Memory:', `${facts.extendedKb} KB`),
                        opt('diag', 'Boot-time Diagnostic Screen:', ENABLED, 'Disabled', ['Display the diagnostic', 'screen during boot'])
                    ]
                },
                get pm() { return driveSubmenu('pm', `Primary Master  [${facts.diskModel}]`, 'hdd', facts); },
                ps: driveSubmenu('ps', 'Primary Slave  [None]', null),
                sm: driveSubmenu('sm', `Secondary Master  [${facts.cdModel}]`, 'cdrom'),
                ss: driveSubmenu('ss', 'Secondary Slave  [None]', null),
                kb: {
                    id: 'kb', title: 'Keyboard Features', items: [
                        opt('numlock', 'NumLock:', ['Auto', 'On', 'Off'], 'Off', ['Selects Power-on state', 'for NumLock']),
                        opt('kbRate', 'Keyboard auto-repeat rate:', ['30/sec', '26.7/sec', '21.8/sec', '18.5/sec', '13.3/sec', '10/sec', '6/sec', '2/sec'], '30/sec', ['Selects the key repeat', 'rate.']),
                        opt('kbDelay', 'Keyboard auto-repeat delay:', ['1/4 sec', '1/2 sec', '3/4 sec', '1 sec'], '1/2 sec', ['Selects the delay before', 'key repeat.'])
                    ]
                },
                advanced: {
                    id: 'advanced', title: 'Advanced', items: [
                        opt('mps', 'Multiprocessor Specification:', ['1.1', '1.4'], '1.4', ['Configures the MP', 'Specification revision', 'level.  Some operating', 'systems will require', '1.1 for compatibility', 'reasons.']),
                        opt('os', 'Installed O/S:', ['Other', 'Win95', 'Win98', 'WinMe', 'Win2000', 'WinXP'], 'Other', ['Select the operating', 'system installed', 'on your system which', 'you will use most', 'commonly.', '', 'Note: An incorrect', 'setting can cause', 'some operating', 'systems to display', 'unexpected behavior.']),
                        opt('escd', 'Reset Configuration Data:', ['No', 'Yes'], 'No', ['If you select Yes, the', 'Extended System', 'Configuration Data', '(ESCD) is cleared on the', 'next boot.']),
                        sub('cache', 'Cache Memory', 'cache', ['Sets the state of the', 'memory cache.']),
                        sub('io', 'I/O Device Configuration', 'io', ['Peripheral Configuration']),
                        opt('lda', 'Large Disk Access Mode:', ['DOS', 'Other'], 'DOS', ['UNIX, Novell NetWare, or', 'other operating systems,', "select 'Other'.", 'If you are installing', 'new software and the', 'drive fails, change', 'this selection and try', 'again.', 'Different operating', 'systems require', 'different', 'representations of', 'drive geometries.']),
                        opt('ide', 'Local Bus IDE adapter:', ['Disabled', 'Primary', 'Secondary', 'Both'], 'Both', ['Enable the integrated', 'local bus IDE adapter.']),
                        sub('chipset', 'Advanced Chipset Control', 'chipset', ['Configure chipset', 'specific features.'])
                    ]
                },
                cache: {
                    id: 'cache', title: 'Cache Memory', items: [
                        opt('memCache', 'Memory Cache:', ENABLED, 'Enabled', ['Sets the state of the', 'memory cache.']),
                        opt('cacheSysBios', 'Cache System BIOS area:', ['Uncached', 'Write Protect'], 'Write Protect', ['Controls caching of', 'system BIOS area.']),
                        opt('cacheVidBios', 'Cache Video BIOS area', ['Uncached', 'Write Protect'], 'Write Protect', ['Controls caching of', 'video BIOS area.']),
                        opt('cacheBase0', 'Cache Base 0-512k:', CACHE_MODES, 'Write Back', ['Controls caching of', '512k base memory.']),
                        opt('cacheBase512', 'Cache Base 512k-640k:', CACHE_MODES, 'Write Back', ['Controls caching of', '512k-640k base memory.']),
                        opt('cacheExt', 'Cache Extended Memory Area:', CACHE_MODES, 'Write Back', ['Controls caching of', 'system memory above one', 'megabyte.'])
                    ].concat(cacheRanges.map((range, i) => opt('cacheR' + i, `Cache ${range}:`, CACHE_MODES, 'Disabled', ['Controls caching of', `${range.replace(' - ', '-')}`, 'accesses.'])))
                },
                io: {
                    id: 'io', title: 'I/O Device Configuration', items: [
                        opt('serA', 'Serial port A:', ['Disabled', 'Enabled', 'Auto', 'OS Controlled'], 'Auto', ['Configure serial port A', 'using options:', '', '[Disabled]', '  No configuration', '', '[Enabled]', '  User configuration', '', '[Auto]', '  BIOS or OS chooses', '  configuration', '', '(OS Controlled)', '  Displayed when', '  controlled by OS']),
                        opt('serB', 'Serial port B:', ['Disabled', 'Enabled', 'Auto', 'OS Controlled'], 'Auto', ['Configure serial port B', 'using options:', '', '[Disabled]', '  No configuration', '', '[Enabled]', '  User configuration', '', '[Auto]', '  BIOS or OS chooses', '  configuration', '', '(OS Controlled)', '  Displayed when', '  controlled by OS']),
                        opt('serBMode', '  Mode:', ['Normal', 'IR', 'ASK-IR'], 'Normal', ['Set the mode for', 'serial port B']),
                        opt('par', 'Parallel port:', ['Disabled', 'Enabled', 'Auto', 'OS Controlled'], 'Auto', ['Configure parallel port', 'using options:', '', '[Disabled]', '  No configuration', '', '[Enabled]', '  User configuration', '', '[Auto]', '  BIOS or OS chooses', '  configuration', '', '(OS Controlled)', '  Displayed when', '  controlled by OS']),
                        opt('parMode', '  Mode:', ['Output only', 'Bi-directional', 'EPP', 'ECP'], 'Bi-directional', ['Set the mode for', 'the parallel port.']),
                        opt('fdc', 'Floppy disk controller:', ['Disabled', 'Enabled', 'Auto'], 'Enabled', ['Configure the floppy', 'disk controller using', 'options:', '', '[Disabled]', '  No configuration', '', '[Enabled]', '  User configuration', '', '[Auto]', '  BIOS or OS chooses', '  configuration'])
                    ]
                },
                chipset: {
                    id: 'chipset', title: 'Advanced Chipset Control', items: [
                        opt('memGap', 'Enable memory gap:', ENABLED, 'Disabled', ['If enabled, turn system', 'RAM off to free address', 'space for use with an', 'option card. Either a', '128KB conventional', 'memory gap, starting at', '512KB, or a 1MB', 'extended memory gap,', 'starting at 15MB, will', 'be created in system', 'RAM.']),
                        opt('ecc', 'ECC Config:', ['Disabled', 'ECC', 'EC'], 'Disabled', ['ECC: Error checking and', 'correcting.', 'EC: Error checking only.']),
                        opt('serr', 'SERR signal condition:', ['None', 'Single bit', 'Multiple bit', 'Both'], 'Multiple bit', ['Select ECC error', 'conditions that SERR#', 'be asserted.'])
                    ]
                },
                security: {
                    id: 'security', title: 'Security', items: [
                        { type: 'status', label: 'Supervisor Password Is:', id: 'supPw' },
                        { type: 'status', label: 'User Password Is:', id: 'usrPw' },
                        blank,
                        { type: 'password', id: 'usrPw', label: 'Set User Password', help: ['User Password controls', 'access to the system at', 'boot.'], needs: 'supPw' },
                        { type: 'password', id: 'supPw', label: 'Set Supervisor Password', help: ['Supervisor Password', 'controls access to the', 'setup utility.'] },
                        blank,
                        opt('pwBoot', 'Password on boot:', ENABLED, 'Disabled', ['Enables password entry', 'on boot.'], { needs: 'supPw' })
                    ]
                },
                boot: { id: 'boot', title: 'Boot', devices: BOOT_DEVICES, items: [] },
                exit: {
                    id: 'exit', title: 'Exit', items: [
                        { type: 'action', id: 'exitSave', label: 'Exit Saving Changes', help: ['Exit System Setup and', 'save your changes to', 'CMOS.'] },
                        { type: 'action', id: 'exitDiscard', label: 'Exit Discarding Changes', help: ['Exit utility without', 'saving Setup data to', 'CMOS.'] },
                        { type: 'action', id: 'loadDefaults', label: 'Load Setup Defaults', help: ['Load default values', 'for all SETUP items.'] },
                        { type: 'action', id: 'discard', label: 'Discard Changes', help: ['Load previous values', 'from CMOS for all SETUP', 'items.'] },
                        { type: 'action', id: 'save', label: 'Save Changes', help: ['Save Setup Data to', 'CMOS.'] }
                    ]
                }
            }
        };
    }

    // ---------- text screen ----------

    function createScreen() {
        const n = ROWS * COLS;
        const s = {
            ch: new Array(n).fill(' '),
            fg: new Uint8Array(n),
            bg: new Uint8Array(n),
            mode: 'text',   // 'text' | 'splash'
            splash: null,   // { progress, prompt, logo } for the POST
            clear(bg, fg) {
                s.ch.fill(' ');
                s.fg.fill(fg == null ? C.grey : fg);
                s.bg.fill(bg == null ? C.black : bg);
            },
            put(x, y, text, fg, bg) {
                if (y < 0 || y >= ROWS) return;
                const str = String(text == null ? '' : text);
                for (let i = 0; i < str.length; i++) {
                    const cx = x + i;
                    if (cx < 0 || cx >= COLS) continue;
                    const k = y * COLS + cx;
                    s.ch[k] = str[i];
                    if (fg != null) s.fg[k] = fg;
                    if (bg != null) s.bg[k] = bg;
                }
            },
            fill(x, y, w, h, ch, fg, bg) {
                for (let r = y; r < y + h; r++) {
                    for (let c = x; c < x + w; c++) {
                        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
                        const k = r * COLS + c;
                        if (ch != null) s.ch[k] = ch;
                        if (fg != null) s.fg[k] = fg;
                        if (bg != null) s.bg[k] = bg;
                    }
                }
            },
            /** Single-line box, outer size w x h. */
            box(x, y, w, h, fg, bg) {
                s.fill(x, y, w, h, ' ', fg, bg);
                s.put(x, y, '┌' + '─'.repeat(Math.max(0, w - 2)) + '┐', fg, bg);
                s.put(x, y + h - 1, '└' + '─'.repeat(Math.max(0, w - 2)) + '┘', fg, bg);
                for (let r = y + 1; r < y + h - 1; r++) {
                    s.put(x, r, '│', fg, bg);
                    s.put(x + w - 1, r, '│', fg, bg);
                }
            },
            /** One cell of black shadow to the right of and below a box. */
            shadow(x, y, w, h) {
                s.fill(x + w, y + 1, 1, h, ' ', C.black, C.black);
                s.fill(x + 1, y + h, w, 1, ' ', C.black, C.black);
            },
            text(row, x0, x1) {
                const a = x0 == null ? 0 : x0;
                const b = x1 == null ? COLS : x1;
                return s.ch.slice(row * COLS + a, row * COLS + b).join('');
            },
            find(str) {
                for (let r = 0; r < ROWS; r++) {
                    const c = s.text(r).indexOf(str);
                    if (c >= 0) return { row: r, col: c };
                }
                return null;
            },
            attr(x, y) {
                const k = y * COLS + x;
                return { ch: s.ch[k], fg: s.fg[k], bg: s.bg[k] };
            }
        };
        s.clear();
        return s;
    }

    // ---------- CMOS ----------

    function readCmos(env) {
        try {
            const raw = env.localStorage && env.localStorage.getItem(CMOS_KEY);
            const data = raw ? JSON.parse(raw) : null;
            return data && typeof data === 'object' ? data : {};
        } catch (_) {
            return {};
        }
    }

    function writeCmos(env, cmos) {
        try {
            if (env.localStorage) env.localStorage.setItem(CMOS_KEY, JSON.stringify(cmos));
        } catch (_) { /* the defaults, then */ }
    }

    function defaultsFor(pages) {
        const out = { bootOrder: ['removable', 'hdd', 'cdrom', 'network'] };
        Object.keys(pages).forEach((id) => {
            (pages[id].items || []).forEach((item) => {
                if (item.type === 'option') out[item.id] = item.def;
            });
        });
        return out;
    }

    /** What the machine reports in Setup: memory from the browser, the disk from storage. */
    function facts(env) {
        const nav = env.navigator || {};
        const gb = Number(nav.deviceMemory) || 4;
        return {
            extendedKb: gb * 1048576 - 1024,
            cpus: Number(nav.hardwareConcurrency) || 2,
            // the drives identify as a Maxtor DiamondMax Plus 9 and an LG Blu-ray burner
            // (HL-DT-ST is how Hitachi-LG drives answer an ATA identify)
            diskModel: 'Maxtor 6Y080L0',
            cdModel: 'LG BH16NS40',
            diskName: 'Maxtor 6Y080L0',
            cdName: 'HL-DT-ST BD-RE  BH16NS40',
            // the storage estimate lands while the POST runs: read it when drawn
            get capacity() {
                const quotaMb = Math.round((Number(env.storageQuota) || 0) / 1048576);
                return quotaMb > 0 ? `${quotaMb}MB` : 'Unknown';
            }
        };
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    // ---------- controller ----------

    /**
     * env: now(), sleep(ms), localStorage, navigator, storageQuota, date() (a Date for the clock)
     * paint(screen) is called after every change. hasOs / hasMedia come to post() from the boot.
     */
    function createBios(env, paint) {
        const screen = createScreen();
        const F = facts(env);
        const def = buildPages(F);
        const DEFAULTS = defaultsFor(def.pages);
        let saved = Object.assign({}, DEFAULTS, readCmos(env));
        let cmos = Object.assign({}, saved);   // the working copy while Setup is open
        const bios = {
            screen,
            config,
            state: 'idle',      // idle | splash | diag | setup | bootmenu | cdprompt | pxe | halt
            request: null,      // 'setup' | 'menu' | 'network' pressed during the POST
            setup: null,        // Setup Utility UI state
            menu: null,         // Boot Menu popup state
            splash: null,
            keyWaiters: [],
            pointer: null
        };

        function render() {
            if (paint) paint(screen, bios);
        }

        /** A key (or null after ms, or when `also` resolves first). */
        function waitKey(ms, also) {
            return new Promise((resolve) => {
                let done = false;
                function finish(key) {
                    if (done) return;
                    done = true;
                    const i = bios.keyWaiters.indexOf(finish);
                    if (i >= 0) bios.keyWaiters.splice(i, 1);
                    resolve(key);
                }
                bios.keyWaiters.push(finish);
                if (ms != null) env.sleep(ms).then(() => finish(null));
                if (also) also.then(() => finish(null));
            });
        }

        function offerKey(key) {
            const waiters = bios.keyWaiters.slice();
            if (!waiters.length) return false;
            waiters.forEach((fn) => fn(key));
            return true;
        }

        // ---- the POST ----

        function postPrompt() {
            if (bios.request === 'setup') return 'Entering SETUP...';
            if (bios.request === 'menu') return 'Entering Boot Menu...';
            if (bios.request === 'network') return 'Entering Network Boot...';
            return 'Press F2 to enter SETUP, F12 for Network Boot, ESC for Boot Menu';
        }

        /**
         * The Starting bar shows the POST's real work (opts.tasks: the disk probe, the cache
         * scan, the first word from the server...): it jumps by a finished task's share (its
         * weight) and stands still while a task runs. It never finishes before splashMs so it
         * can be read.
         */
        async function splash(run, work) {
            bios.state = 'splash';
            screen.mode = 'splash';
            const started = env.now();
            screen.splash = { progress: 0, prompt: postPrompt() };
            render();
            for (;;) {
                if (run && run.cancelled && run.cancelled()) return false;
                const elapsed = env.now() - started;
                const progress = work ? work.progress(elapsed) : Math.min(1, elapsed / config.splashMs);
                screen.splash = { progress, prompt: postPrompt() };
                render();
                if (elapsed >= config.splashMs && (!work || (work.done() && progress >= 1))) break;
                await env.sleep(50);
            }
            screen.splash = { progress: 1, prompt: postPrompt() };
            render();
            await env.sleep(bios.request ? config.enteringMs : config.splashHoldMs);
            return !(run && run.cancelled && run.cancelled());
        }

        /** Runs opts.tasks ({ id, run }) in order; progress(elapsed) is what the bar shows. */
        function startWork(tasks) {
            const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t.run === 'function') : [];
            const state = { done: 0, startedAt: env.now(), results: {}, finished: list.length === 0, shown: 0, shownAt: env.now() };
            (async () => {
                for (const task of list) {
                    state.startedAt = env.now();
                    try {
                        state.results[task.id] = await task.run();
                    } catch (_) {
                        state.results[task.id] = null;
                    }
                    state.done += 1;
                }
                state.finished = true;
            })();
            const gaps = config.barStepGapsMs;
            const weights = list.map((task) => (Number(task.weight) > 0 ? Number(task.weight) : 1));
            const totalWeight = weights.reduce((a, b) => a + b, 0);
            return {
                done: () => state.finished,
                results: () => state.results,
                progress: (elapsed) => {
                    // No tasks: the same jumps on the clock, one per gap, full by splashMs
                    if (!list.length) {
                        let at = 0;
                        let steps = 0;
                        while (steps < gaps.length && elapsed >= (at += gaps[steps])) steps += 1;
                        return elapsed >= config.splashMs ? 1 : steps / (gaps.length + 1);
                    }
                    // one jump per finished task, each at least its gap after the last; a slow
                    // task holds the bar where it is
                    const now = env.now();
                    if (state.shown < state.done && now - state.shownAt >= gaps[state.shown % gaps.length]) {
                        state.shown += 1;
                        state.shownAt = now;
                    }
                    if (state.shown >= list.length) return 1;
                    return weights.slice(0, state.shown).reduce((a, b) => a + b, 0) / totalWeight;
                }
            };
        }

        /** Boot-time Diagnostic Screen: the text POST, memory counted up (work runs underneath). */
        async function diagnostic(run, work) {
            void work;
            bios.state = 'diag';
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            const lines = [
                'PhoenixBIOS 4.0 Release 6.0',
                'Copyright 1985-2001 Phoenix Technologies Ltd.',
                'All Rights Reserved',
                'Copyright 2000-2026 Xyridian Corporation',
                '',
                `CPU = ${F.cpus} Processors`,
                '640K System RAM Passed'
            ];
            let row = 0;
            for (const line of lines) {
                screen.put(0, row++, line);
                render();
                if (run && run.cancelled && run.cancelled()) return false;
                await env.sleep(config.diagStepMs);
            }
            const totalM = Math.round(F.extendedKb / 1024);
            const t0 = env.now();
            for (;;) {
                const f = Math.min(1, (env.now() - t0) / config.diagMemoryMs);
                screen.put(0, row, `${String(Math.round(totalM * f)).padStart(4)}M Extended RAM Passed`);
                render();
                if (f >= 1) break;
                await env.sleep(40);
                if (run && run.cancelled && run.cancelled()) return false;
            }
            row++;
            const rest = [
                '256K Cache SRAM Passed',
                'System BIOS shadowed',
                'Video BIOS shadowed',
                `Fixed Disk 0: ${F.diskName}`,
                `ATAPI CD-ROM: ${F.cdName}`,
                'Mouse initialized',
                ''
            ];
            for (const line of rest) {
                screen.put(0, row++, line);
                render();
                if (run && run.cancelled && run.cancelled()) return false;
                await env.sleep(config.diagStepMs);
            }
            const promptRow = row;
            const t1 = env.now();
            while (env.now() - t1 < config.splashMs * 0.6) {
                screen.put(0, promptRow, ' '.repeat(COLS));
                screen.put(0, promptRow, postPrompt());
                render();
                await env.sleep(80);
                if (run && run.cancelled && run.cancelled()) return false;
            }
            screen.put(0, promptRow, ' '.repeat(COLS));
            screen.put(0, promptRow, postPrompt());
            render();
            await env.sleep(bios.request ? config.enteringMs : config.splashHoldMs);
            return true;
        }

        function bootOrder() {
            const order = Array.isArray(cmos.bootOrder) ? cmos.bootOrder.slice() : DEFAULTS.bootOrder.slice();
            DEFAULTS.bootOrder.forEach((id) => { if (order.indexOf(id) === -1) order.push(id); });
            return order.filter((id) => DEFAULTS.bootOrder.indexOf(id) !== -1);
        }

        /** "Press any key to boot from CD or DVD..." → true when a key came in time. */
        async function cdPrompt() {
            bios.state = 'cdprompt';
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            screen.put(0, 0, 'Press any key to boot from CD or DVD...');
            render();
            const key = await waitKey(config.cdPromptMs);
            return key != null;
        }

        /**
         * The Intel Boot Agent. reason: what the POST's network card found (opts.serverDown):
         * 'media' no link (the device is offline), 'dhcp' nobody answered (the server is not
         * reachable), anything else a server that answered with nothing to boot (E53, also
         * F12 or Network in the boot order with the server up).
         */
        async function pxe(reason) {
            bios.state = 'pxe';
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            const head = ['Intel(R) Boot Agent GE v1.3.15', 'Copyright (C) 1997-2026, Intel Corporation', ''];
            const mac = 'CLIENT MAC ADDR: 00 0C 29 4D 53 46  GUID: 564D4D45-4C45-544F-4E46-580000000000';
            let row = 0;
            const line = async (text, ms) => {
                screen.put(0, row++, text);
                render();
                await env.sleep(ms == null ? config.diagStepMs : ms);
            };
            for (const text of head) await line(text);
            if (reason === 'media') {
                await line('Initializing and establishing link...', config.pxeMs * 0.6);
                await line('PXE-E61: Media test failure, check cable');
            } else if (reason === 'dhcp') {
                await line(mac);
                // DHCP with the spinner the agent turns while it waits for an offer
                const spin = '|/-\\';
                const t0 = env.now();
                for (let i = 0; env.now() - t0 < config.pxeMs; i++) {
                    screen.put(0, row, 'DHCP' + '.'.repeat(Math.min(5, 1 + (i >> 2))) + spin[i % 4]);
                    render();
                    await env.sleep(90);
                }
                row++;
                await line('PXE-E51: No DHCP or proxyDHCP offers were received.');
            } else {
                await line(mac, config.pxeMs * 0.6);
                await line('PXE-E53: No boot filename received');
            }
            await line('');
            await line('PXE-M0F: Exiting Intel Boot Agent.', config.diagStepMs * 3);
        }

        /**
         * "Operating System not found" until a key reboots. until(stopped): resolves true when
         * the device should reboot by itself (the server is back); polled no longer once stopped().
         */
        async function halt(until) {
            bios.state = 'halt';
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            screen.put(0, 0, 'Operating System not found');
            render();
            let stopped = false;
            const back = typeof until === 'function'
                ? Promise.resolve(until(() => stopped)).then((ok) => (ok ? true : new Promise(() => {})))
                : null;
            await waitKey(null, back);
            stopped = true;
        }

        // The PIN pad under "Password on boot": three columns of text-mode keys, tap or click
        const PIN_PAD = [
            ['1', '1'], ['2', '2'], ['3', '3'],
            ['4', '4'], ['5', '5'], ['6', '6'],
            ['7', '7'], ['8', '8'], ['9', '9'],
            ['\u2190', 'Backspace'], ['0', '0'], ['OK', 'Enter']
        ];
        const PIN_KEY_W = 9;
        const PIN_KEY_H = 3;
        const PIN_KEY_GAP = 2;

        function drawPinPad(x, y, w) {
            const span = PIN_KEY_W * 3 + PIN_KEY_GAP * 2;
            const x0 = x + Math.floor((w - span) / 2);
            bios.pinPad = PIN_PAD.map(([label, key], i) => {
                const c = x0 + (i % 3) * (PIN_KEY_W + PIN_KEY_GAP);
                const r = y + Math.floor(i / 3) * PIN_KEY_H;
                const pressed = bios.pinPadPressed === key;
                const fg = pressed ? C.white : C.black;
                const bg = pressed ? C.blue : C.grey;
                screen.box(c, r, PIN_KEY_W, PIN_KEY_H, fg, bg);
                screen.put(c + Math.floor((PIN_KEY_W - label.length) / 2), r + 1, label, fg, bg);
                return { col: c, row: r, key };
            });
        }

        function pinPadKeyAt(col, row) {
            const pad = bios.pinPad || [];
            return pad.find((k) => col >= k.col && col < k.col + PIN_KEY_W && row >= k.row && row < k.row + PIN_KEY_H) || null;
        }

        // The open password box: bios.bootPin { title, label, entry, maxLength, pad, submit, resolve }
        function drawBootPinPrompt(entry) {
            bios.state = 'bootpin';
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            const box = bios.bootPin || {};
            const label = box.label || 'Enter PIN:';
            const pad = box.pad === true;
            const w = 44;
            const h = pad ? 21 : 7;
            const x = Math.floor((COLS - w) / 2);
            const y = pad ? 1 : 8;
            bios.pinPad = null;
            const field = w - 4 - label.length - 2;
            screen.box(x, y, w, h, C.black, C.white);
            screen.shadow(x, y, w, h);
            screen.put(x + 2, y + 1, box.title || 'Password on boot', C.black, C.white);
            screen.put(x + 2, y + 3, label, C.black, C.white);
            const stars = '*'.repeat(Math.min((entry || '').length, field));
            screen.put(x + 4 + label.length, y + 3, stars.padEnd(field, ' '), C.white, C.black);
            if (pad) drawPinPad(x, y + 5, w);
            if (bios.bootPinError) {
                screen.put(x + 2, y + (pad ? 18 : 5), bios.bootPinError.slice(0, w - 4), C.red, C.white);
            }
            render();
        }

        /**
         * "Gateway Password": the site gate's passphrase, before the PIN, when the server says
         * this device's key is gone or stale (/status siteAccess.passed false). An installed
         * device gets back in here instead of going through the homepage after a wipe.
         * Resolves true, 'cancelled', or false never (it stays until a right answer or Esc).
         */
        async function promptGatewayPassword() {
            bios.bootPinError = '';
            return new Promise((resolve) => {
                bios.bootPin = {
                    title: 'Gateway Password',
                    label: 'Enter password:',
                    maxLength: 512,
                    anyChar: true,
                    entry: '',
                    resolve,
                    async submit(password) {
                        const box = bios.bootPin;
                        try {
                            const res = await fetch('/', {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json', 'X-Dreamscape-Client': 'melaton-bios' },
                                body: JSON.stringify({ action: 'gateway', data: { password } })
                            });
                            const json = await res.json().catch(() => null);
                            if (res.ok && json && json.success) {
                                bios.bootPin = null;
                                bios.bootPinError = '';
                                resolve(true);
                                return;
                            }
                            bios.bootPinError = res.status === 429 ? 'Too many attempts, try later' : 'Incorrect password';
                        } catch (_err) {
                            bios.bootPinError = 'Gateway not reachable';
                        }
                        if (bios.bootPin !== box) return;
                        box.entry = '';
                        drawBootPinPrompt('');
                    }
                };
                drawBootPinPrompt('');
            });
        }

        async function promptBootPinLogin() {
            bios.bootPinError = '';
            let entry = '';
            bios.bootPin = null;
            return new Promise((resolve) => {
                bios.bootPin = {
                    title: 'Password on boot',
                    label: 'Enter PIN:',
                    maxLength: 64,
                    pad: true,
                    entry,
                    resolve,
                    async submit(pin) {
                        try {
                            const res = await fetch('/', {
                                method: 'POST',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json', 'X-Dreamscape-Client': 'melaton-bios' },
                                body: JSON.stringify({ action: 'login', data: { pin } })
                            });
                            const json = await res.json();
                            if (res.ok && json && json.success) {
                                try { localStorage.setItem('userType', json.userType || 'admin'); } catch (_e) { /* ignore */ }
                                bios.bootPin = null;
                                bios.bootPinError = '';
                                resolve(true);
                                return;
                            }
                            bios.bootPinError = 'Incorrect password';
                            bios.bootPin.entry = '';
                            drawBootPinPrompt('');
                        } catch (_err) {
                            bios.bootPinError = 'Login failed';
                            bios.bootPin.entry = '';
                            drawBootPinPrompt('');
                        }
                    }
                };
                drawBootPinPrompt(entry);
            });
        }

        /**
         * Runs the POST. opts.hasOs: Melaton is installed (the Hard Drive boots); a function
         * is asked once opts.tasks have run (the bar shows them). Resolves { device, via } with
         * device 'hdd' | 'cdrom', or 'cancelled' when opts.run says so.
         */
        async function post(opts = {}) {
            const run = opts.run || null;
            bios.request = null;
            let work = startWork(opts.tasks);
            let first = true;
            for (;;) {
                cmos = Object.assign({}, saved);   // a working copy Setup did not save is gone on reboot
                if (!first) work = startWork(opts.tasks);
                first = false;
                const ok = cmos.diag === 'Enabled' ? await diagnostic(run, work) : await splash(run, work);
                if (!ok) return 'cancelled';
                while (!work.done()) {
                    if (run && run.cancelled && run.cancelled()) return 'cancelled';
                    await env.sleep(50);
                }
                bios.work = work.results();
                // The network card found no server (opts.serverDown → a pxe() reason): no gate or
                // PIN to ask it, nothing any device can boot; Setup and the Boot Menu still open
                const down = typeof opts.serverDown === 'function' ? await opts.serverDown(bios.work) : null;
                if (run && run.cancelled && run.cancelled()) return 'cancelled';
                // Gate 1 before the PIN: the Gateway Password when the key is stale or missing
                if (!down && typeof opts.requireGateway === 'function' && await opts.requireGateway()) {
                    const gatewayOk = await promptGatewayPassword();
                    if (gatewayOk === 'cancelled') return 'cancelled';
                    if (typeof opts.onGateway === 'function') await opts.onGateway();
                }
                const needBootPin = !down && (cmos.pwBoot === 'Enabled'
                    || (typeof opts.requireBootPin === 'function' && !!(await opts.requireBootPin())));
                if (needBootPin) {
                    const bootPinOk = await promptBootPinLogin();
                    if (bootPinOk === 'cancelled') return 'cancelled';
                    if (!bootPinOk) continue;
                }
                opts.hasOs = typeof opts.hasOsAfter === 'function' ? !!(await opts.hasOsAfter(work.results())) : opts.hasOs;
                if (bios.request === 'setup') {
                    const outcome = await runSetup();
                    bios.request = null;
                    if (outcome === 'reboot') continue;
                }
                let order = bootOrder();
                if (bios.request === 'network') order = ['network'].concat(order.filter((d) => d !== 'network'));
                if (bios.request === 'menu') {
                    const pick = await bootMenu();
                    bios.request = null;
                    if (pick === 'setup') {
                        const outcome = await runSetup();
                        if (outcome === 'reboot') continue;
                        order = bootOrder();
                    } else if (pick) {
                        order = [pick].concat(order.filter((d) => d !== pick));
                    }
                }
                if (down) {
                    // the boot agent tries the network and gives up, then the POST has nothing left;
                    // a key (or the server answering again, opts.serverBack) reboots
                    await pxe(down);
                    await halt(opts.serverBack);
                    bios.request = null;
                    continue;
                }
                const hddFirst = order.indexOf('hdd') < order.indexOf('cdrom');
                for (const device of order) {
                    if (run && run.cancelled && run.cancelled()) return 'cancelled';
                    if (device === 'hdd' && opts.hasOs) return { device: 'hdd', via: 'order' };
                    if (device === 'cdrom') {
                        // Vista's CD boot sector only asks when the disk could boot by itself
                        if (opts.hasOs && !hddFirst) {
                            if (await cdPrompt()) return { device: 'cdrom', via: 'prompt' };
                            continue;
                        }
                        if (opts.hasOs) return { device: 'cdrom', via: 'order' };
                        return { device: 'cdrom', via: 'order' };
                    }
                    if (device === 'network') await pxe();
                    // removable: nothing in it
                }
                await halt();
                bios.request = null;
            }
        }

        // ---- the Boot Menu (ESC) ----

        function drawBootMenu() {
            screen.mode = 'text';
            screen.clear(C.black, C.grey);
            const m = bios.menu;
            const rows = def.pages.boot.devices.map((d, i) => `${i + 1}. ${d.id === 'hdd' ? '+' : ' '}${d.label}`).concat(['   <Enter Setup>']);
            const w = 40;
            const h = rows.length + 2;
            const x = Math.floor((COLS - w) / 2);
            const y = 8;
            screen.box(x, y, w, h, C.black, C.grey);
            screen.shadow(x, y, w, h);
            const title = ' Boot Menu ';
            screen.put(x + Math.floor((w - title.length) / 2), y, title, C.black, C.grey);
            rows.forEach((text, i) => {
                const sel = i === m.sel;
                screen.fill(x + 1, y + 1 + i, w - 2, 1, ' ', sel ? C.white : C.blue, sel ? C.black : C.grey);
                screen.put(x + 2, y + 1 + i, text, sel ? C.white : C.blue, sel ? C.black : C.grey);
            });
            render();
        }

        function bootMenu() {
            bios.state = 'bootmenu';
            const count = def.pages.boot.devices.length + 1;
            bios.menu = { sel: 1, count };
            drawBootMenu();
            return new Promise((resolve) => {
                bios.menu.resolve = (pick) => {
                    bios.menu = null;
                    resolve(pick);
                };
            });
        }

        function menuKey(key) {
            const m = bios.menu;
            if (!m) return false;
            if (key === 'ArrowUp') m.sel = Math.max(0, m.sel - 1);
            else if (key === 'ArrowDown') m.sel = Math.min(m.count - 1, m.sel + 1);
            else if (key === 'Enter') {
                const devices = def.pages.boot.devices;
                m.resolve(m.sel < devices.length ? devices[m.sel].id : 'setup');
                return true;
            } else if (key === 'Escape') {
                m.resolve(null);
                return true;
            } else return true;
            drawBootMenu();
            return true;
        }

        // ---- the Setup Utility ----

        function valueOf(item) {
            if (item.type === 'option') return cmos[item.id] != null ? cmos[item.id] : item.def;
            return null;
        }

        function selectable(item, page) {
            if (!item || item.type === 'blank' || item.type === 'info' || item.type === 'status') return false;
            if (item.needs && cmos[item.needs + 'Set'] !== true) return false;
            return true;
        }

        function pageOf(id) {
            return def.pages[id];
        }

        function firstSelectable(page, from, dir) {
            const items = page.items;
            let i = from;
            for (let n = 0; n < items.length; n++) {
                if (i < 0) i = items.length - 1;
                if (i >= items.length) i = 0;
                if (selectable(items[i], page)) return i;
                i += dir;
            }
            return -1;
        }

        function openPage(id, pushParent) {
            const st = bios.setup;
            const page = pageOf(id);
            if (!page) return;
            if (pushParent && st.page) st.stack.push({ page: st.page, sel: st.sel, scroll: st.scroll });
            st.page = id;
            st.scroll = 0;
            st.sel = page.devices ? 1 : firstSelectable(page, 0, 1);
            st.field = 0;
        }

        function runSetup() {
            bios.state = 'setup';
            screen.mode = 'text';
            bios.setup = { page: null, stack: [], sel: 0, scroll: 0, field: 0, popup: null, bootExpanded: false, tab: 0 };
            openPage('main');
            drawSetup();
            // System Time ticks: redraw once a second while the utility is open
            const timer = (env.setInterval || setInterval)(() => { if (bios.setup) drawSetup(); }, 1000);
            return new Promise((resolve) => {
                bios.setup.resolve = (outcome) => {
                    (env.clearInterval || clearInterval)(timer);
                    bios.setup = null;
                    resolve(outcome);
                };
            });
        }

        function currentTab() {
            const st = bios.setup;
            if (!st) return null;
            const rootPage = st.stack.length ? st.stack[0].page : st.page;
            return rootPage;
        }

        function bodyRows() {
            return 22 - 6 + 1; // rows 6..21 hold items on a submenu; top pages start at row 4
        }

        function drawKeybar(kind) {
            const bar = KEYBAR[kind] || KEYBAR.page;
            screen.fill(0, 23, COLS, 2, ' ', C.black, C.cyan);
            bar.forEach((line, i) => {
                line.forEach(([text, col], j) => {
                    screen.put(col, 23 + i, text, j % 2 === 0 ? C.white : C.black, C.cyan);
                });
            });
        }

        function drawFrame(helpTitle) {
            // rows 2..22: a black single-line frame over grey, split at col 53
            screen.fill(0, 2, COLS, 21, ' ', C.blue, C.grey);
            screen.put(0, 2, '┌' + '─'.repeat(52) + '┬' + '─'.repeat(25) + '┐', C.black, C.grey);
            for (let r = 3; r <= 21; r++) {
                screen.put(0, r, '│', C.black, C.grey);
                screen.put(53, r, '│', C.black, C.grey);
                screen.put(79, r, '│', C.black, C.grey);
            }
            screen.put(0, 22, '└' + '─'.repeat(52) + '┴' + '─'.repeat(25) + '┘', C.black, C.grey);
            if (helpTitle) {
                screen.put(54 + Math.floor((25 - helpTitle.length) / 2), 3, helpTitle, C.black, C.grey);
                screen.put(53, 4, '├' + '─'.repeat(25) + '┤', C.black, C.grey);
            }
        }

        function drawHelp(lines) {
            (lines || []).slice(0, 16).forEach((line, i) => {
                screen.put(55, 6 + i, line.slice(0, 24), C.black, C.grey);
            });
        }

        function timeText() {
            const d = env.date ? env.date() : new Date();
            return [pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds())];
        }

        function dateText() {
            const d = env.date ? env.date() : new Date();
            return [pad2(d.getMonth() + 1), pad2(d.getDate()), String(d.getFullYear())];
        }

        function drawItems(page, top) {
            const st = bios.setup;
            const items = page.items;
            const visible = 22 - top;      // rows top..21
            const scrollable = items.length > visible;
            if (scrollable) {
                if (st.sel >= 0 && st.sel < st.scroll) st.scroll = st.sel;
                if (st.sel >= st.scroll + visible) st.scroll = st.sel - visible + 1;
            } else st.scroll = 0;
            for (let i = st.scroll; i < items.length && i - st.scroll < visible; i++) {
                const item = items[i];
                const row = top + (i - st.scroll);
                const sel = i === st.sel;
                if (item.type === 'blank') continue;
                const greyed = item.greyed || (item.needs && cmos[item.needs + 'Set'] !== true);
                const labelCol = (item.type === 'sub' ? 4 : 4);
                if (item.type === 'sub') {
                    screen.put(2, row, '►', sel ? C.white : C.blue, C.grey);
                    screen.put(labelCol, row, item.label, sel ? C.white : C.blue, C.grey);
                    if (item.value) screen.put(34, row, item.value(), sel ? C.white : C.blue, C.grey);
                } else if (item.type === 'info') {
                    screen.put(labelCol, row, item.label, C.blue, C.grey);
                    screen.put(34, row, typeof item.value === 'function' ? item.value() : item.value, C.blue, C.grey);
                } else if (item.type === 'status') {
                    screen.put(labelCol, row, item.label, C.blue, C.grey);
                    screen.put(34, row, cmos[item.id + 'Set'] === true ? 'Set' : 'Clear', C.blue, C.grey);
                } else if (item.type === 'action') {
                    screen.put(labelCol, row, item.label, sel ? C.white : C.blue, C.grey);
                } else if (item.type === 'password') {
                    screen.put(labelCol, row, item.label, greyed ? C.blue : (sel ? C.white : C.blue), C.grey);
                    screen.put(34, row, '[', C.black, C.grey);
                    screen.put(35, row, 'Enter', greyed ? C.dark : (sel ? C.white : C.black), sel && !greyed ? C.black : C.grey);
                    screen.put(40, row, ']', C.black, C.grey);
                } else if (item.type === 'time' || item.type === 'date') {
                    const parts = item.type === 'time' ? timeText() : dateText();
                    const sep = item.type === 'time' ? ':' : '/';
                    screen.put(labelCol, row, item.label, sel ? C.white : C.blue, C.grey);
                    let col = 34;
                    screen.put(col++, row, '[', C.black, C.grey);
                    parts.forEach((p, f) => {
                        const on = sel && st.field === f;
                        screen.put(col, row, p, on ? C.white : C.black, on ? C.black : C.grey);
                        col += p.length;
                        if (f < parts.length - 1) screen.put(col++, row, sep, C.black, C.grey);
                    });
                    screen.put(col, row, ']', C.black, C.grey);
                } else if (item.type === 'option') {
                    const value = valueOf(item);
                    screen.put(labelCol, row, item.label, sel ? C.white : C.blue, C.grey);
                    screen.put(34, row, '[', greyed ? C.dark : C.black, C.grey);
                    screen.put(35, row, value, greyed ? C.dark : (sel ? C.white : C.black), sel && !greyed ? C.black : C.grey);
                    screen.put(35 + value.length, row, ']', greyed ? C.dark : C.black, C.grey);
                }
            }
            if (scrollable) {
                // a scrollbar in col 52: arrows and the dark-shade track with a block thumb
                screen.put(52, top, '▲', C.black, C.grey);
                screen.put(52, 21, '▼', C.black, C.grey);
                const trackH = 21 - top - 1;
                const thumb = Math.max(1, Math.round(trackH * visible / items.length));
                const at = Math.round((trackH - thumb) * (st.scroll / Math.max(1, items.length - visible)));
                for (let r = 0; r < trackH; r++) {
                    const inThumb = r >= at && r < at + thumb;
                    screen.put(52, top + 1 + r, inThumb ? '█' : '▒', C.black, C.grey);
                }
            }
        }

        function drawBootPage(page) {
            const st = bios.setup;
            const order = bootOrder();
            let row = 4;
            const lines = [];
            order.forEach((id, i) => {
                const dev = page.devices.find((d) => d.id === id);
                lines.push({ index: i, text: (dev.children ? (st.bootExpanded ? '-' : '+') : ' ') + dev.label, dev, top: true });
                if (dev.children && st.bootExpanded) {
                    dev.children.forEach((child) => lines.push({ index: -1, text: '   ' + child, dev }));
                }
            });
            st.bootLines = lines;
            lines.forEach((line, i) => {
                const sel = i === st.sel;
                screen.put(6, row + i, line.text, sel ? C.white : C.blue, C.grey);
            });
            drawHelp(page.devices[0].help);
        }

        function drawTabs() {
            const st = bios.setup;
            screen.fill(0, 1, COLS, 1, ' ', C.white, C.blue);
            const tab = currentTab();
            const positions = { main: 4, advanced: 13, security: 26, boot: 39, exit: 48 };
            const inSub = st.stack.length > 0;
            def.tabs.forEach((id) => {
                if (inSub && id !== tab) return;
                const label = pageOf(id).title;
                const col = positions[id];
                if (id === tab) {
                    screen.fill(col - 2, 1, label.length + 4, 1, ' ', C.black, C.grey);
                    screen.put(col, 1, label, C.black, C.grey);
                } else {
                    screen.put(col, 1, label, C.white, C.blue);
                }
            });
        }

        function drawPopup() {
            const st = bios.setup;
            const p = st.popup;
            if (!p) return;
            if (p.type === 'options') {
                const w = Math.max(...p.options.map((o) => o.length)) + 4;
                const h = p.options.length + 2;
                const x = Math.min(COLS - w - 2, Math.max(34, p.x || 34));
                const y = Math.max(2, Math.min(22 - h, p.y - Math.floor(h / 2)));
                screen.box(x, y, w, h, C.white, C.blue);
                screen.shadow(x, y, w, h);
                p.options.forEach((o, i) => {
                    const sel = i === p.sel;
                    screen.fill(x + 1, y + 1 + i, w - 2, 1, ' ', sel ? C.black : C.white, sel ? C.grey : C.blue);
                    screen.put(x + 2, y + 1 + i, o, sel ? C.black : C.white, sel ? C.grey : C.blue);
                });
            } else if (p.type === 'confirm' || p.type === 'notice') {
                const lines = p.lines;
                const w = Math.max(30, ...lines.map((l) => l.length + 6));
                const h = lines.length + 5;
                const x = Math.floor((COLS - w) / 2);
                const y = Math.floor((ROWS - h) / 2) - 1;
                screen.box(x, y, w, h, C.black, C.white);
                screen.shadow(x, y, w, h);
                const title = ' ' + (p.title || 'Setup Confirmation') + ' ';
                screen.put(x + Math.floor((w - title.length) / 2), y, title, C.black, C.white);
                lines.forEach((line, i) => screen.put(x + Math.floor((w - line.length) / 2), y + 2 + i, line, C.black, C.white));
                const btnRow = y + h - 2;
                if (p.type === 'confirm') {
                    const yes = '[Yes]';
                    const no = '[No]';
                    const gap = 6;
                    const total = yes.length + gap + no.length;
                    const bx = x + Math.floor((w - total) / 2);
                    screen.put(bx, btnRow, yes, p.sel === 0 ? C.white : C.black, p.sel === 0 ? C.black : C.white);
                    screen.put(bx + yes.length + gap, btnRow, no, p.sel === 1 ? C.white : C.black, p.sel === 1 ? C.black : C.white);
                } else {
                    const ok = '[Continue]';
                    screen.put(x + Math.floor((w - ok.length) / 2), btnRow, ok, C.white, C.black);
                }
            } else if (p.type === 'help') {
                const w = 66;
                const h = 18;
                const x = Math.floor((COLS - w) / 2);
                const y = 3;
                screen.box(x, y, w, h, C.black, C.white);
                screen.shadow(x, y, w, h);
                const title = 'General Help';
                screen.put(x + Math.floor((w - title.length) / 2), y + 1, title, C.black, C.white);
                screen.put(x, y + 2, '├' + '─'.repeat(w - 2) + '┤', C.black, C.white);
                const visible = 11;
                const lines = GENERAL_HELP;
                p.scroll = Math.max(0, Math.min(p.scroll || 0, lines.length - visible));
                for (let i = 0; i < visible; i++) {
                    const line = lines[p.scroll + i];
                    if (line != null) screen.put(x + 2, y + 3 + i, line.slice(0, w - 6), C.black, C.white);
                }
                // scrollbar
                screen.put(x + w - 2, y + 3, '▲', C.black, C.white);
                screen.put(x + w - 2, y + 3 + visible - 1, '▼', C.black, C.white);
                const trackH = visible - 2;
                const thumb = Math.max(1, Math.round(trackH * visible / lines.length));
                const at = Math.round((trackH - thumb) * (p.scroll / Math.max(1, lines.length - visible)));
                for (let r = 0; r < trackH; r++) screen.put(x + w - 2, y + 4 + r, r >= at && r < at + thumb ? '█' : '▒', C.dark, C.white);
                const ok = '[Continue]';
                screen.put(x + Math.floor((w - ok.length) / 2), y + h - 2, ok, C.white, C.black);
            } else if (p.type === 'password') {
                const w = 34;
                const h = 7;
                const x = Math.floor((COLS - w) / 2);
                const y = 8;
                screen.box(x, y, w, h, C.black, C.white);
                screen.shadow(x, y, w, h);
                const title = ' ' + p.title + ' ';
                screen.put(x + Math.floor((w - title.length) / 2), y, title, C.black, C.white);
                const mask = (s) => '*'.repeat(s.length).padEnd(8, ' ');
                screen.put(x + 2, y + 2, 'Enter New Password', C.black, C.white);
                screen.put(x + 22, y + 2, '[' + mask(p.first) + ']', p.field === 0 ? C.white : C.black, p.field === 0 ? C.black : C.white);
                screen.put(x + 2, y + 4, 'Confirm New Password', C.black, C.white);
                screen.put(x + 22, y + 4, '[' + mask(p.second) + ']', p.field === 1 ? C.white : C.black, p.field === 1 ? C.black : C.white);
            }
        }

        function drawSetup() {
            const st = bios.setup;
            if (!st) return;
            const page = pageOf(st.page);
            screen.mode = 'text';
            screen.fill(0, 0, COLS, 1, ' ', C.black, C.cyan);
            const title = 'PhoenixBIOS Setup Utility';
            screen.put(Math.floor((COLS - title.length) / 2), 0, title, C.black, C.cyan);
            drawTabs();
            drawFrame('Item Specific Help');
            const isSub = st.stack.length > 0;
            if (isSub) {
                screen.put(1 + Math.floor((52 - page.title.length) / 2), 3, page.title, C.blue, C.grey);
            }
            if (page.devices) {
                drawBootPage(page);
            } else {
                drawItems(page, isSub ? 6 : 4);
                const item = page.items[st.sel];
                drawHelp(item && item.help);
            }
            drawKeybar(st.page === 'exit' ? 'exit' : 'page');
            drawPopup();
            render();
        }

        function confirm(lines, onYes, title) {
            bios.setup.popup = { type: 'confirm', lines, sel: 0, onYes, title: title || 'Setup Confirmation' };
        }

        function notice(lines, title) {
            bios.setup.popup = { type: 'notice', lines, title: title || 'Setup Notice' };
        }

        function cycle(item, dir) {
            const i = item.options.indexOf(valueOf(item));
            const next = (i + dir + item.options.length) % item.options.length;
            cmos[item.id] = item.options[next];
        }

        function dirty() {
            return JSON.stringify(cmos) !== JSON.stringify(saved);
        }

        function save() {
            saved = Object.assign({}, cmos);
            writeCmos(env, saved);
        }

        function execute(id) {
            const st = bios.setup;
            if (id === 'exitSave') {
                confirm(['Save configuration changes and exit now?'], () => { save(); st.resolve('reboot'); });
            } else if (id === 'exitDiscard') {
                if (!dirty()) {
                    st.resolve('reboot');
                    return;
                }
                confirm(['Configuration has not been saved!', 'Save before exiting?'], () => { save(); st.resolve('reboot'); }, 'Setup Warning');
                st.popup.onNo = () => st.resolve('reboot');
            } else if (id === 'loadDefaults') {
                confirm(['Load default configuration now?'], () => { cmos = Object.assign({}, DEFAULTS); });
            } else if (id === 'discard') {
                confirm(['Load previous configuration now?'], () => { cmos = Object.assign({}, saved); });
            } else if (id === 'save') {
                confirm(['Save configuration changes now?'], () => { save(); });
            }
        }

        function popupKey(key, ch) {
            const st = bios.setup;
            const p = st.popup;
            if (p.type === 'options') {
                if (key === 'ArrowUp') p.sel = Math.max(0, p.sel - 1);
                else if (key === 'ArrowDown') p.sel = Math.min(p.options.length - 1, p.sel + 1);
                else if (key === 'Enter') { cmos[p.item.id] = p.options[p.sel]; st.popup = null; }
                else if (key === 'Escape') st.popup = null;
                return;
            }
            if (p.type === 'confirm') {
                if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') p.sel = p.sel === 0 ? 1 : 0;
                else if (key === 'Enter') {
                    st.popup = null;
                    if (p.sel === 0) p.onYes();
                    else if (p.onNo) p.onNo();
                } else if (key === 'Escape') st.popup = null;
                else if (key === 'y' || key === 'Y') { st.popup = null; p.onYes(); }
                else if (key === 'n' || key === 'N') { st.popup = null; if (p.onNo) p.onNo(); }
                return;
            }
            if (p.type === 'notice') {
                if (key === 'Enter' || key === 'Escape') st.popup = null;
                return;
            }
            if (p.type === 'help') {
                if (key === 'ArrowDown') p.scroll = (p.scroll || 0) + 1;
                else if (key === 'ArrowUp') p.scroll = Math.max(0, (p.scroll || 0) - 1);
                else if (key === 'Enter' || key === 'Escape' || key === 'F1') st.popup = null;
                return;
            }
            if (p.type === 'password') {
                if (key === 'Escape') { st.popup = null; return; }
                if (key === 'Enter') {
                    if (p.field === 0) { p.field = 1; return; }
                    st.popup = null;
                    if (p.first !== p.second) { notice(['Passwords do not match.', 'Password not set.'], 'Setup Warning'); return; }
                    cmos[p.id + 'Set'] = p.first.length > 0;
                    notice(p.first.length ? ['Changes have been saved.'] : ['Password has been cleared.'], 'Setup Notice');
                    return;
                }
                if (key === 'Tab') { p.field = p.field === 0 ? 1 : 0; return; }
                if (key === 'Backspace') {
                    if (p.field === 0) p.first = p.first.slice(0, -1);
                    else p.second = p.second.slice(0, -1);
                    return;
                }
                if (ch && ch.length === 1 && /[ -~]/.test(ch)) {
                    if (p.field === 0 && p.first.length < 8) p.first += ch;
                    else if (p.field === 1 && p.second.length < 8) p.second += ch;
                }
            }
        }

        function bootPageKey(key) {
            const st = bios.setup;
            const lines = st.bootLines || [];
            if (key === 'ArrowUp') st.sel = Math.max(0, st.sel - 1);
            else if (key === 'ArrowDown') st.sel = Math.min(lines.length - 1, st.sel + 1);
            else if (key === 'Enter') {
                const line = lines[st.sel];
                if (line && line.dev.children) st.bootExpanded = !st.bootExpanded;
            } else if (key === '+' || key === '-' || key === 'F5' || key === 'F6') {
                const line = lines[st.sel];
                if (!line || !line.top) return;
                const order = bootOrder();
                const i = order.indexOf(line.dev.id);
                const j = (key === '+' || key === 'F6') ? i - 1 : i + 1;
                if (j < 0 || j >= order.length) return;
                const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
                cmos.bootOrder = order;
                // follow the moved device
                const target = order[j];
                st.sel = lines.findIndex((l) => l.top && l.dev.id === target);
                if (st.sel < 0) st.sel = 0;
                // lines are rebuilt on draw; recompute the index after reorder
                const topIndex = order.indexOf(target);
                let count = 0;
                let sel = 0;
                order.forEach((id, k) => {
                    if (k === topIndex) sel = count;
                    count += 1;
                    const dev = def.pages.boot.devices.find((d) => d.id === id);
                    if (dev.children && st.bootExpanded) count += dev.children.length;
                });
                st.sel = sel;
            }
        }

        function setupKey(key, ch) {
            const st = bios.setup;
            if (!st) return false;
            if (st.popup) {
                popupKey(key, ch);
                drawSetup();
                return true;
            }
            const page = pageOf(st.page);
            const tabIndex = def.tabs.indexOf(currentTab());
            if (key === 'F1') {
                st.popup = { type: 'help', scroll: 0 };
            } else if (key === 'F9') {
                confirm(['Load default configuration now?'], () => { cmos = Object.assign({}, DEFAULTS); });
            } else if (key === 'F10') {
                confirm(['Save configuration changes and exit now?'], () => { save(); st.resolve('reboot'); });
            } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
                if (st.stack.length) {
                    // a sub-menu keeps its parent tab; left/right do nothing there
                } else {
                    const next = (tabIndex + (key === 'ArrowLeft' ? -1 : 1) + def.tabs.length) % def.tabs.length;
                    openPage(def.tabs[next]);
                }
            } else if (key === 'Escape') {
                if (st.stack.length) {
                    const back = st.stack.pop();
                    st.page = back.page;
                    st.sel = back.sel;
                    st.scroll = back.scroll;
                } else if (st.page !== 'exit') {
                    openPage('exit');
                }
            } else if (page.devices) {
                bootPageKey(key);
            } else if (key === 'ArrowUp' || key === 'ArrowDown') {
                const dir = key === 'ArrowUp' ? -1 : 1;
                const next = firstSelectable(page, st.sel + dir, dir);
                if (next >= 0) st.sel = next;
                st.field = 0;
            } else if (key === 'Home') {
                st.sel = firstSelectable(page, 0, 1);
            } else if (key === 'End') {
                st.sel = firstSelectable(page, page.items.length - 1, -1);
            } else if (key === 'PageUp' || key === 'PageDown') {
                const dir = key === 'PageUp' ? -1 : 1;
                for (let n = 0; n < 10; n++) {
                    const next = firstSelectable(page, st.sel + dir, dir);
                    if (next < 0 || (dir > 0 && next < st.sel) || (dir < 0 && next > st.sel)) break;
                    st.sel = next;
                }
            } else {
                const item = page.items[st.sel];
                if (!item) return true;
                if (item.type === 'option') {
                    if (key === 'Enter') {
                        const row = (st.stack.length ? 6 : 4) + (st.sel - st.scroll);
                        st.popup = { type: 'options', item, options: item.options, sel: item.options.indexOf(valueOf(item)), x: 34, y: row };
                    } else if (key === '+' || key === ' ' || key === 'F6') cycle(item, 1);
                    else if (key === '-' || key === 'F5') cycle(item, -1);
                } else if (item.type === 'sub') {
                    if (key === 'Enter') openPage(item.page, true);
                } else if (item.type === 'action') {
                    if (key === 'Enter') execute(item.id);
                } else if (item.type === 'password') {
                    if (key === 'Enter') st.popup = { type: 'password', id: item.id, title: item.label, first: '', second: '', field: 0 };
                } else if (item.type === 'time' || item.type === 'date') {
                    if (key === 'Tab' || key === 'Enter') st.field = (st.field + 1) % 3;
                    // the clock is the browser's; +/- leave it alone
                }
            }
            drawSetup();
            return true;
        }

        /** Keyboard. Returns true when the BIOS used the key. ch is the printable character, if any. */
        function handleKey(key, ch) {
            if (bios.state === 'splash' || bios.state === 'diag') {
                if (key === 'F2') { bios.request = 'setup'; return true; }
                if (key === 'Escape') { bios.request = 'menu'; return true; }
                if (key === 'F12') { bios.request = 'network'; return true; }
                return false;
            }
            if (bios.state === 'setup') return setupKey(key, ch);
            if (bios.state === 'bootmenu') return menuKey(key);
            if (bios.state === 'cdprompt' || bios.state === 'halt') return offerKey(key);
            if (bios.state === 'bootpin' && bios.bootPin) {
                if (key === 'Escape') {
                    const box = bios.bootPin;
                    bios.bootPin = null;
                    bios.bootPinError = '';
                    if (box.resolve) box.resolve('cancelled');
                    return true;
                }
                if (key === 'Enter') {
                    bios.bootPin.submit(bios.bootPin.entry || '');
                    return true;
                }
                if (key === 'Backspace') {
                    bios.bootPin.entry = (bios.bootPin.entry || '').slice(0, -1);
                    drawBootPinPrompt(bios.bootPin.entry);
                    return true;
                }
                const typed = ch && ch.length === 1 && (bios.bootPin.anyChar ? ch >= ' ' && ch !== '\x7f' : /[ -~]/.test(ch));
                if (typed && (bios.bootPin.entry || '').length < (bios.bootPin.maxLength || 64)) {
                    bios.bootPin.entry = (bios.bootPin.entry || '') + ch;
                    drawBootPinPrompt(bios.bootPin.entry);
                }
                return true;
            }
            return false;
        }

        /**
         * Pointer, in cells (the canvas view converts). A tab name, an item row or a key-bar
         * key: the nearest keyboard action. A tap on the selected item is Enter.
         */
        function handlePointer(col, row) {
            if (bios.state === 'bootpin' && bios.bootPin) {
                const hit = pinPadKeyAt(col, row);
                if (!hit) return true;
                // the key shows pressed for a moment, then acts like the keyboard's
                bios.pinPadPressed = hit.key;
                handleKey(hit.key, hit.key.length === 1 ? hit.key : '');
                if (bios.state === 'bootpin' && bios.bootPin) drawBootPinPrompt(bios.bootPin.entry || '');
                setTimeout(() => {
                    if (bios.pinPadPressed !== hit.key) return;
                    bios.pinPadPressed = null;
                    if (bios.state === 'bootpin' && bios.bootPin) drawBootPinPrompt(bios.bootPin.entry || '');
                }, 120);
                return true;
            }
            if (bios.state === 'bootmenu') {
                const m = bios.menu;
                const y = 8;
                const i = row - y - 1;
                if (i >= 0 && i < m.count) {
                    if (m.sel === i) return menuKey('Enter');
                    m.sel = i;
                    drawBootMenu();
                }
                return true;
            }
            if (bios.state === 'cdprompt' || bios.state === 'halt') return offerKey('Pointer');
            if (bios.state !== 'setup') return false;
            const st = bios.setup;
            if (st.popup) {
                const p = st.popup;
                if (p.type === 'options') {
                    const idx = p.options.findIndex((o, i) => screen.find(o) && false);
                    // find the option line under the pointer
                    for (let i = 0; i < p.options.length; i++) {
                        const where = screen.find(p.options[i]);
                        if (where && where.row === row) {
                            if (p.sel === i) return setupKey('Enter');
                            p.sel = i;
                            drawSetup();
                            return true;
                        }
                    }
                    void idx;
                    return setupKey('Escape');
                }
                if (p.type === 'confirm') {
                    const yes = screen.find('[Yes]');
                    const no = screen.find('[No]');
                    if (yes && yes.row === row && col >= yes.col && col < yes.col + 5) { p.sel = 0; return setupKey('Enter'); }
                    if (no && no.row === row && col >= no.col && col < no.col + 4) { p.sel = 1; return setupKey('Enter'); }
                    return true;
                }
                return setupKey('Enter');
            }
            if (row === 23 || row === 24) {
                const bar = KEYBAR[st.page === 'exit' ? 'exit' : 'page'][row - 23];
                for (let j = bar.length - 1; j >= 0; j--) {
                    if (col >= bar[j][1]) {
                        const key = bar[j][0];
                        const map = { 'F1': 'F1', 'Esc': 'Escape', '↑↓': 'ArrowDown', '↔': 'ArrowRight', '-/+': '+', 'Enter': 'Enter', 'F9': 'F9', 'F10': 'F10' };
                        const k = map[key] || map[bar[j - (j % 2)][0]];
                        return setupKey(k);
                    }
                }
                return true;
            }
            if (row === 1 && !st.stack.length) {
                const positions = { main: 4, advanced: 13, security: 26, boot: 39, exit: 48 };
                let hit = null;
                def.tabs.forEach((id) => {
                    const c = positions[id];
                    if (col >= c - 2 && col < c + pageOf(id).title.length + 2) hit = id;
                });
                if (hit) { openPage(hit); drawSetup(); }
                return true;
            }
            const page = pageOf(st.page);
            if (page.devices) {
                const i = row - 4;
                const lines = st.bootLines || [];
                if (i >= 0 && i < lines.length) {
                    if (st.sel === i) return setupKey('Enter');
                    st.sel = i;
                    drawSetup();
                }
                return true;
            }
            const top = st.stack.length ? 6 : 4;
            const i = st.scroll + (row - top);
            if (i >= 0 && i < page.items.length && selectable(page.items[i], page)) {
                if (st.sel === i) return setupKey('Enter');
                st.sel = i;
                st.field = 0;
                drawSetup();
            }
            return true;
        }

        /** Design mode / tests: open one screen without a POST. */
        function preview(name) {
            if (name === 'splash') {
                bios.state = 'splash';
                screen.mode = 'splash';
                screen.splash = { progress: 0.55, prompt: postPrompt() };
                render();
                return;
            }
            if (name === 'setup') {
                runSetup();
                return;
            }
            if (name === 'bootmenu') {
                bootMenu();
                return;
            }
            if (name === 'diag') {
                diagnostic();
                return;
            }
            if (name === 'cdprompt') {
                cdPrompt();
                return;
            }
            if (name === 'pxe') {
                pxe('dhcp').then(() => halt());
            }
        }

        function cmosValue(id) {
            return cmos[id];
        }

        Object.assign(bios, { post, runSetup, bootMenu, handleKey, handlePointer, preview, bootOrder, cmosValue, drawSetup, facts: F, defaults: DEFAULTS, pages: def });
        return bios;
    }

    // ---------- canvas painter ----------

    const SPLASH_BAR_CELLS = 66;    // x 92 to 620 of 640: the bar runs to near the right edge

    /** Whole cells of the Starting bar for a 0..1 progress (never a fraction of a character). */
    function splashBarCells(progress) {
        return Math.floor(Math.max(0, Math.min(1, progress || 0)) * SPLASH_BAR_CELLS);
    }

    /**
     * Paints the text screen into a 640 x 480 canvas: 8 x 19 cells, the 8 x 16 glyph on rows
     * 1-16 (box-drawing and block glyphs extend over the padding rows so lines join). The
     * splash is the POST logo (the Xyridian OEM logo, where VMware draws its own) over the Starting bar.
     */
    function createCanvasPainter(canvas, font, logo) {
        const ctx = canvas.getContext('2d');
        const cache = new Map();
        const JOIN = new Set(['│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬', '█', '░', '▒', '▓']);
        function tile(ch, fg, bg) {
            const key = ch + '\0' + fg + '\0' + bg;
            let t = cache.get(key);
            if (t) return t;
            const g = font.glyph(ch);
            const img = ctx.createImageData(CELL_W, CELL_H);
            const d = img.data;
            const fgc = hex(PALETTE[fg]);
            const bgc = hex(PALETTE[bg]);
            const join = JOIN.has(ch);
            for (let y = 0; y < CELL_H; y++) {
                let gr = y - 1;
                if (gr < 0) gr = join ? 0 : -1;
                if (gr > 15) gr = join ? 15 : -1;
                const bits = gr >= 0 ? g[gr] : 0;
                for (let x = 0; x < CELL_W; x++) {
                    const on = (bits >> (7 - x)) & 1;
                    const c = on ? fgc : bgc;
                    const o = (y * CELL_W + x) * 4;
                    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
                }
            }
            t = img;
            cache.set(key, t);
            return t;
        }
        function hex(h) {
            return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        }
        function textAt(x, y, str, fg, advance) {
            for (let i = 0; i < str.length; i++) {
                const g = font.glyph(str[i]);
                ctx.fillStyle = PALETTE[fg];
                for (let r = 0; r < 16; r++) {
                    const bits = g[r];
                    for (let c = 0; c < 8; c++) {
                        if ((bits >> (7 - c)) & 1) ctx.fillRect(x + i * advance + c, y + r, 1, 1);
                    }
                }
            }
        }
        return function paint(screen) {
            ctx.imageSmoothingEnabled = false;
            if (screen.mode === 'splash') {
                const s = screen.splash || { progress: 0, prompt: '' };
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, 640, 480);
                if (logo && logo.complete && logo.naturalWidth) {
                    // the OEM logo (Xyridian) where VMware's wordmark sits: fitted in 240 x 96, centred on 320, 238
                    const k = Math.min(240 / logo.naturalWidth, 96 / logo.naturalHeight);
                    const w = Math.round(logo.naturalWidth * k);
                    const h = Math.round(logo.naturalHeight * k);
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(logo, Math.round(320 - w / 2), Math.round(238 - h / 2), w, h);
                    ctx.imageSmoothingEnabled = false;
                }
                textAt(16, 442, 'Starting', C.grey, 9);
                // the Starting bar is 43 character cells (8 px each) and fills a whole cell at a time
                ctx.fillStyle = PALETTE[C.dark];
                ctx.fillRect(92, 440, SPLASH_BAR_CELLS * CELL_W, 20);
                ctx.fillStyle = PALETTE[C.grey];
                ctx.fillRect(92, 440, splashBarCells(s.progress) * CELL_W, 20);
                const prompt = s.prompt || '';
                textAt(Math.round((640 - prompt.length * 8) / 2), 461, prompt, C.white, 8);
                return;
            }
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const k = r * COLS + c;
                    ctx.putImageData(tile(screen.ch[k], screen.fg[k], screen.bg[k]), c * CELL_W, r * CELL_H);
                }
            }
            ctx.fillStyle = '#000';
            ctx.fillRect(0, ROWS * CELL_H, 640, 480 - ROWS * CELL_H);
        };
    }

    const api = { config, COLS, ROWS, CELL_W, CELL_H, C, PALETTE, CMOS_KEY, GENERAL_HELP, SPLASH_BAR_CELLS, splashBarCells, createScreen, createBios, createCanvasPainter, buildPages, defaultsFor, facts, readCmos, writeCmos };
    if (root) root.MelatonPhoenixBios = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
