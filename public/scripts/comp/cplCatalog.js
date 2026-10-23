/**
 * Control Panel catalog (Yozora #632): Vista's Control Panel items, categories and task links,
 * 1:1 with the Vista VM (Shell namespace 3 and the Category view's pages, captured 2026-10-22),
 * with "Windows" rewritten to Melaton (copyrights-not-1to1.mdc). melatonControlPanel.js builds
 * Category View, the category pages and Classic View from it.
 *
 * Item:     { id, name, art, cats, tip, open }
 *             art   public/static_images/vista-cpl/items/<art>-{16,32,48}.png (or a full path)
 *             cats  category ids (Classic View's Category column; Vista's order)
 *             open  an action (below)
 * Category: { id, name, art, home: [link], items: [{ item, links: [link] }] }
 *             home  the two or three links under the category on Control Panel Home
 * Link:     { t: text, s: true when Vista draws the UAC shield, a: action }
 * Action:   'item:<id>'           open an item as its icon does
 *           'page:<id>[:<arg>]'   a Control Panel page (melatonControlPanel registerPage)
 *           'dialog:<id>[:<tab>]' a property sheet (cplDialogs.js)
 *           'call:<global>[:<arg>]'
 *           'cat:<id>'            a category page
 */
(function (root) {
    'use strict';

    const CATEGORIES = [
        { id: 'system', name: 'System and Maintenance', art: 'system-and-maintenance',
            home: [
                { t: 'Get started with Melaton', a: 'item:welcome-center' },
                { t: 'Back up your computer', a: 'item:backup' }
            ],
            items: [
                { item: 'welcome-center', links: [
                    { t: 'Get started with Melaton', a: 'item:welcome-center' },
                    { t: 'Find which version of Melaton you are using', a: 'item:system' }] },
                { item: 'backup', links: [
                    { t: 'Back up your computer', a: 'page:backup:backup' },
                    { t: 'Restore files from backup', a: 'page:backup:restore' }] },
                { item: 'system', links: [
                    { t: 'View amount of RAM and processor speed', a: 'item:system' },
                    { t: "Check your computer's Melaton Experience Index base score", a: 'item:performance' },
                    { t: 'Allow remote access', s: true, a: 'item:remote-access' },
                    { t: 'See the name of this computer', a: 'item:system' }] },
                { item: 'meleton-update', links: [
                    { t: 'Turn automatic updating on or off', a: 'page:update' },
                    { t: 'Check for updates', a: 'page:update' },
                    { t: 'View installed updates', a: 'page:programs:updates' }] },
                { item: 'power-options', links: [
                    { t: 'Require a password when the computer wakes', a: 'page:power-options:password' },
                    { t: 'Change what the power buttons do', a: 'page:power-options:buttons' },
                    { t: 'Change when the computer sleeps', a: 'page:power-options:plan' }] },
                { item: 'melaton-search', links: [
                    { t: 'Change how Melaton searches', a: 'item:melaton-search' }] },
                { item: 'problem-reports', links: [
                    { t: 'Check for new solutions', a: 'page:problem-reports:check' },
                    { t: 'Choose how to check for solutions', a: 'page:problem-reports:settings' },
                    { t: 'View problem history', a: 'page:problem-reports:history' }] },
                { item: 'performance', links: [
                    { t: "Check your computer's Melaton Experience Index base score", a: 'item:performance' },
                    { t: 'Use tools to improve performance', a: 'page:performance:tools' }] },
                { item: 'device-manager', links: [
                    { t: 'View hardware and devices', s: true, a: 'item:device-manager' },
                    { t: 'Update device drivers', s: true, a: 'item:device-manager' }] },
                { item: 'administrative-tools', links: [
                    { t: 'Free up disk space', a: 'call:openDataManagementDsap' },
                    { t: 'Defragment your hard drive', s: true, a: 'page:administrative-tools' },
                    { t: 'Create and format hard disk partitions', s: true, a: 'page:administrative-tools' },
                    { t: 'View event logs', s: true, a: 'call:openEventViewerApplet' },
                    { t: 'Schedule tasks', s: true, a: 'page:administrative-tools' }] }
            ] },
        { id: 'security', name: 'Security', art: 'security',
            home: [
                { t: 'Check for updates', a: 'page:update' },
                { t: "Check this computer's security status", a: 'item:security-center' },
                { t: 'Allow a program through Melaton Firewall', s: true, a: 'dialog:firewall:exceptions' }
            ],
            items: [
                { item: 'security-center', links: [
                    { t: 'Check for updates', a: 'page:update' },
                    { t: "Check this computer's security status", a: 'item:security-center' },
                    { t: 'Turn automatic updating on or off', a: 'page:update' },
                    { t: 'Check firewall status', s: true, a: 'item:firewall' },
                    { t: 'Require a password when the computer wakes', a: 'page:power-options:password' }] },
                { item: 'firewall', links: [
                    { t: 'Turn Melaton Firewall on or off', s: true, a: 'dialog:firewall:general' },
                    { t: 'Allow a program through Melaton Firewall', s: true, a: 'dialog:firewall:exceptions' }] },
                { item: 'meleton-update', links: [
                    { t: 'Turn automatic updating on or off', a: 'page:update' },
                    { t: 'Check for updates', a: 'page:update' },
                    { t: 'View installed updates', a: 'page:programs:updates' }] },
                { item: 'windows-defender', links: [
                    { t: 'Scan for spyware and other potentially unwanted software', a: 'item:windows-defender' }] },
                { item: 'internet-options', links: [
                    { t: 'Change security settings', a: 'dialog:internet-options:security' },
                    { t: 'Delete browsing history and cookies', a: 'dialog:internet-options:general' },
                    { t: 'Manage browser add-ons', a: 'dialog:internet-options:programs' }] },
                { item: 'parental-controls', links: [
                    { t: 'Set up parental controls for any user', s: true, a: 'item:parental-controls' },
                    { t: 'View activity reports', s: true, a: 'item:parental-controls' }] },
                { item: 'bitlocker', links: [
                    { t: 'Protect your computer by encrypting data on your disk', s: true, a: 'item:bitlocker' },
                    { t: 'Manage BitLocker keys', s: true, a: 'item:bitlocker' }] }
            ] },
        { id: 'network', name: 'Network and Internet', art: 'network-and-internet',
            home: [
                { t: 'View network status and tasks', a: 'item:network' },
                { t: 'Set up file sharing', a: 'item:network' }
            ],
            items: [
                { item: 'network', links: [
                    { t: 'View network status and tasks', a: 'item:network' },
                    { t: 'Connect to a network', a: 'call:toggleMelatonConnectDialog' },
                    { t: 'View network computers and devices', a: 'call:openExplorerApplet:Network' },
                    { t: 'Add a device to the network', a: 'item:add-hardware' },
                    { t: 'Set up file sharing', a: 'item:network' }] },
                { item: 'internet-options', links: [
                    { t: 'Change your homepage', a: 'dialog:internet-options:general' },
                    { t: 'Manage browser add-ons', a: 'dialog:internet-options:programs' },
                    { t: 'Delete browsing history and cookies', a: 'dialog:internet-options:general' }] },
                { item: 'offline-files', links: [
                    { t: 'Encrypt your offline files', a: 'dialog:offline-files:encryption' },
                    { t: 'Manage disk space used by your offline files', a: 'dialog:offline-files:disk' }] },
                { item: 'firewall', links: [
                    { t: 'Turn Melaton Firewall on or off', s: true, a: 'dialog:firewall:general' },
                    { t: 'Allow a program through Melaton Firewall', s: true, a: 'dialog:firewall:exceptions' }] },
                { item: 'people-near-me', links: [
                    { t: 'Sign in or out of People Near Me', a: 'dialog:people-near-me:signin' },
                    { t: 'Change People Near Me settings', a: 'dialog:people-near-me' }] },
                { item: 'sync-center', links: [
                    { t: 'Sync with other computers, mobile devices, or network folders', a: 'item:sync-center' },
                    { t: 'View sync results', a: 'page:sync-center:results' },
                    { t: 'Resolve sync conflicts', a: 'page:sync-center:conflicts' }] }
            ] },
        { id: 'hardware', name: 'Hardware and Sound', art: 'hardware-and-sound',
            home: [
                { t: 'Play CDs or other media automatically', a: 'item:autoplay' },
                { t: 'Printer', a: 'item:printers' },
                { t: 'Mouse', a: 'item:mouse' }
            ],
            items: [
                { item: 'printers', links: [
                    { t: 'Add a printer', a: 'page:printers:add' },
                    { t: 'Change default printer', a: 'item:printers' },
                    { t: 'Remove a printer', a: 'item:printers' },
                    { t: 'Send a fax', a: 'item:printers' }] },
                { item: 'autoplay', links: [
                    { t: 'Change default settings for media or devices', a: 'item:autoplay' },
                    { t: 'Play CDs or other media automatically', a: 'item:autoplay' }] },
                { item: 'sound', links: [
                    { t: 'Adjust system volume', a: 'call:openVolumeMixer' },
                    { t: 'Change system sounds', a: 'item:sound' },
                    { t: 'Manage audio devices', a: 'item:sound' }] },
                { item: 'mouse', links: [
                    { t: 'Change button settings', a: 'dialog:mouse:buttons' },
                    { t: 'Change pointer appearance', a: 'dialog:mouse:pointers' }] },
                { item: 'power-options', links: [
                    { t: 'Change power-saving settings', a: 'page:power-options' },
                    { t: 'Change what the power buttons do', a: 'page:power-options:buttons' },
                    { t: 'Require a password when the computer wakes', a: 'page:power-options:password' },
                    { t: 'Change when the computer sleeps', a: 'page:power-options:plan' }] },
                { item: 'personalization', links: [
                    { t: 'Change size of on-screen items', s: true, a: 'item:personalization' },
                    { t: 'Adjust screen resolution', a: 'item:personalization' },
                    { t: 'How to correct monitor flicker (refresh rate)', a: 'call:openHelpAndSupport' }] },
                { item: 'scanners-and-cameras', links: [
                    { t: 'View scanners and cameras', a: 'item:scanners-and-cameras' },
                    { t: 'Scan a document or picture', a: 'item:scanners-and-cameras' }] },
                { item: 'keyboard', links: [
                    { t: 'Change cursor blink rate', a: 'dialog:keyboard:speed' },
                    { t: 'Check keyboard status', a: 'dialog:keyboard:hardware' }] },
                { item: 'device-manager', links: [
                    { t: 'View hardware and devices', s: true, a: 'item:device-manager' },
                    { t: 'Update device drivers', s: true, a: 'item:device-manager' }] },
                { item: 'phone-and-modem', links: [
                    { t: 'Set up dialing rules', a: 'item:phone-and-modem' }] },
                { item: 'game-controllers', links: [
                    { t: 'Set up USB game controllers', a: 'item:game-controllers' }] },
                { item: 'sideshow', links: [
                    { t: 'Set up a secondary display to use with Melaton SideShow', a: 'item:sideshow' }] },
                { item: 'pen-and-input', links: [
                    { t: 'Change tablet pen settings', a: 'item:pen-and-input' }] },
                { item: 'color-management', links: [
                    { t: 'Change advanced color management settings for displays, scanners, and printers', a: 'dialog:color-management:advanced' }] },
                { item: 'tablet-pc', links: [
                    { t: 'Change screen orientation', a: 'item:tablet-pc' }] },
                { item: 'bluetooth', links: [
                    { t: 'Add a Wireless Device', a: 'item:bluetooth' },
                    { t: 'Bluetooth Settings', a: 'dialog:bluetooth:options' }] }
            ] },
        { id: 'programs', name: 'Programs', art: 'programs',
            home: [
                { t: 'Uninstall a program', a: 'item:programs' },
                { t: 'Change startup programs', a: 'item:windows-defender' }
            ],
            items: [
                { item: 'programs', links: [
                    { t: 'Uninstall a program', a: 'item:programs' },
                    { t: 'Turn Melaton features on or off', s: true, a: 'page:programs:features' },
                    { t: 'View installed updates', a: 'page:programs:updates' },
                    { t: 'Use an older program with this version of Melaton', a: 'call:openHelpAndSupport' },
                    { t: 'How to install a program', a: 'call:openHelpAndSupport' }] },
                { item: 'windows-defender', links: [
                    { t: 'Scan for spyware and other potentially unwanted software', a: 'item:windows-defender' },
                    { t: 'View currently running programs', a: 'item:windows-defender' }] },
                { item: 'default-programs', links: [
                    { t: 'Stop a program from running at startup', a: 'item:windows-defender' },
                    { t: 'Change default settings for media or devices', a: 'item:autoplay' },
                    { t: 'Make a file type always open in a specific program', a: 'page:default-programs:associate' },
                    { t: 'Set your default programs', a: 'page:default-programs:defaults' }] },
                { item: 'sideshow', links: [
                    { t: 'Set up a secondary display to use with Melaton SideShow', a: 'item:sideshow' }] },
                { item: 'sidebar-properties', links: [
                    { t: 'Add gadgets to Sidebar', a: 'call:openSidebarGadgetGallery' },
                    { t: 'Uninstall a gadget', a: 'call:openSidebarGadgetGallery' }] },
                { item: 'get-programs', links: [
                    { t: 'Get new programs online at Melaton Marketplace', a: 'item:get-programs' },
                    { t: 'Manage programs you buy online (digital locker)', a: 'item:get-programs' }] }
            ] },
        { id: 'users', name: 'User Accounts and Family Safety', art: 'user-accounts-and-family-safety',
            home: [
                { t: 'Set up parental controls for any user', s: true, a: 'item:parental-controls' },
                { t: 'Add or remove user accounts', s: true, a: 'item:user-accounts' }
            ],
            items: [
                { item: 'user-accounts', links: [
                    { t: 'Change your account picture', a: 'item:user-accounts' },
                    { t: 'Add or remove user accounts', s: true, a: 'item:user-accounts' },
                    { t: 'Change your Melaton password', a: 'item:user-accounts' }] },
                { item: 'parental-controls', links: [
                    { t: 'Set up parental controls for any user', s: true, a: 'item:parental-controls' },
                    { t: 'View activity reports', s: true, a: 'item:parental-controls' }] },
                { item: 'cardspace', links: [
                    { t: 'Manage Information Cards that are used to log on to online services', a: 'item:cardspace' }] }
            ] },
        { id: 'appearance', name: 'Appearance and Personalization', art: 'appearance-and-personalization',
            home: [
                { t: 'Change desktop background', a: 'page:desktop-background' },
                { t: 'Customize colors', a: 'item:appearance' },
                { t: 'Adjust screen resolution', a: 'item:personalization' }
            ],
            items: [
                { item: 'personalization', links: [
                    { t: 'Change desktop background', a: 'page:desktop-background' },
                    { t: 'Customize colors', a: 'item:appearance' },
                    { t: 'Adjust screen resolution', a: 'item:personalization' },
                    { t: 'Change screen saver', a: 'call:openScreenSaverSettings' },
                    { t: 'Change the theme', a: 'call:openThemeSettings' }] },
                { item: 'taskbar', links: [
                    { t: 'Customize the Start menu', a: 'call:openStartMenuProperties' },
                    { t: 'Customize icons on the taskbar', a: 'item:taskbar' },
                    { t: 'Change the picture on the Start menu', a: 'item:user-accounts' }] },
                { item: 'ease-of-access', links: [
                    { t: 'Accommodate low vision', a: 'page:ease-of-access:vision' },
                    { t: 'Change screen reader', a: 'page:ease-of-access:reader' },
                    { t: 'Underline keyboard shortcuts and access keys', a: 'page:ease-of-access:keyboard' },
                    { t: 'Turn High Contrast on or off', a: 'page:ease-of-access:vision' }] },
                { item: 'folder-options', links: [
                    { t: 'Specify single- or double-click to open', a: 'dialog:folder-options:general' },
                    { t: 'Use Classic Melaton folders', a: 'dialog:folder-options:general' },
                    { t: 'Show hidden files and folders', a: 'dialog:folder-options:view' }] },
                { item: 'fonts', links: [
                    { t: 'Install or remove a font', a: 'item:fonts' }] },
                { item: 'sidebar-properties', links: [
                    { t: 'Add gadgets to Sidebar', a: 'call:openSidebarGadgetGallery' },
                    { t: 'Choose whether to keep Sidebar on top of other windows', a: 'item:sidebar-properties' }] }
            ] },
        { id: 'clock', name: 'Clock, Language, and Region', art: 'clock-language-and-region',
            home: [
                { t: 'Change keyboards or other input methods', a: 'dialog:regional:keyboards' },
                { t: 'Change display language', a: 'dialog:regional:keyboards' }
            ],
            items: [
                { item: 'date-and-time', links: [
                    { t: 'Set the time and date', a: 'item:date-and-time' },
                    { t: 'Change the time zone', a: 'item:date-and-time' },
                    { t: 'Add clocks for different time zones', a: 'dialog:date-and-time:clocks' },
                    { t: 'Add the Clock gadget to Melaton Sidebar', a: 'call:openSidebarGadgetGallery' }] },
                { item: 'regional', links: [
                    { t: 'Install or uninstall display languages', s: true, a: 'dialog:regional:keyboards' },
                    { t: 'Change display language', a: 'dialog:regional:keyboards' },
                    { t: 'Change the country or region', a: 'dialog:regional:location' },
                    { t: 'Change the date, time, or number format', a: 'dialog:regional:formats' },
                    { t: 'Change keyboards or other input methods', a: 'dialog:regional:keyboards' }] }
            ] },
        { id: 'access', name: 'Ease of Access', art: 'ease-of-access',
            home: [
                { t: 'Let Melaton suggest settings', a: 'page:ease-of-access:questionnaire' },
                { t: 'Optimize visual display', a: 'page:ease-of-access:vision' }
            ],
            items: [
                { item: 'ease-of-access', links: [
                    { t: 'Let Melaton suggest settings', a: 'page:ease-of-access:questionnaire' },
                    { t: 'Optimize visual display', a: 'page:ease-of-access:vision' },
                    { t: 'Replace sounds with visual cues', a: 'page:ease-of-access:sounds' },
                    { t: 'Change how your mouse works', a: 'page:ease-of-access:mouse' },
                    { t: 'Change how your keyboard works', a: 'page:ease-of-access:keyboard' }] },
                { item: 'speech-recognition', links: [
                    { t: 'Start speech recognition', a: 'item:speech-recognition' },
                    { t: 'Set up a microphone', a: 'item:speech-recognition' }] }
            ] },
        { id: 'additional', name: 'Additional Options', art: 'additional-options',
            home: [],
            // Vista lists "View 32-bit Control Panel Items" here (an x64 artefact); Melaton's own
            // items without a Vista home live here instead
            items: [
                { item: 'mail', links: [] },
                { item: 'runes', links: [] },
                { item: 'authentication', links: [] }
            ] }
    ];

    // Vista's 49 items (less View 32-bit Control Panel Items) and Melaton's own, in Vista's names
    // with Windows -> Melaton. Existing items keep their ids (melatonControlPanel.js and the cpl*.js
    // files register them); the catalog adds the art and the categories.
    const ITEMS = [
        { id: 'add-hardware', name: 'Add Hardware', art: 'add-hardware', cats: ['hardware'], tip: 'Add new hardware to your computer.', open: 'dialog:add-hardware' },
        { id: 'administrative-tools', name: 'Administrative Tools', art: 'administrative-tools', cats: ['system'], tip: 'Configure administrative settings for your computer.', open: 'page:administrative-tools' },
        { id: 'autoplay', name: 'AutoPlay', art: 'autoplay', cats: ['hardware'], tip: 'Change default settings for CDs, DVDs, and devices so that you can automatically play music, view pictures, install software, and play games.', open: 'page:autoplay' },
        { id: 'backup', name: 'Backup and Restore Center', art: 'backup-and-restore-center', cats: ['system'], tip: 'Back up your files and your computer, and restore them from a backup.', open: 'page:backup' },
        { id: 'bitlocker', name: 'BitLocker Drive Encryption', art: 'bitlocker-drive-encryption', cats: ['security'], tip: 'Help protect your data by encrypting your disk.', open: 'page:bitlocker' },
        { id: 'bluetooth', name: 'Bluetooth Devices', art: 'bluetooth-devices', cats: ['hardware'], tip: 'Add, remove, and configure Bluetooth devices.', open: 'page:bluetooth-devices' },
        { id: 'color-management', name: 'Color Management', art: 'color-management', cats: ['hardware'], tip: 'Change advanced color management settings for displays, scanners, and printers.', open: 'dialog:color-management' },
        { id: 'date-and-time', name: 'Date and Time', art: 'date-and-time', cats: ['clock'], tip: 'Set the date, time, and time zone for your computer.', open: 'dialog:date-and-time' },
        { id: 'default-programs', name: 'Default Programs', art: 'default-programs', cats: ['programs'], tip: 'Choose the programs that Melaton uses by default.', open: 'page:default-programs' },
        { id: 'device-manager', name: 'Device Manager', art: 'device-manager', cats: ['hardware', 'system'], tip: 'View and update your hardware settings and driver software.', open: 'call:openDeviceManager' },
        { id: 'ease-of-access', name: 'Ease of Access Center', art: 'ease-of-access-center', cats: ['access', 'appearance'], tip: 'Make your computer easier to use.', open: 'page:ease-of-access' },
        { id: 'folder-options', name: 'Folder Options', art: 'folder-options', cats: ['appearance'], tip: 'Customize how folders and files are displayed in Cartograph.', open: 'dialog:folder-options' },
        { id: 'fonts', name: 'Fonts', art: 'fonts', cats: ['appearance'], tip: 'Add, change, and manage fonts on your computer.', open: 'page:fonts' },
        { id: 'game-controllers', name: 'Game Controllers', art: 'game-controllers', cats: ['hardware'], tip: 'Set up and test game controllers.', open: 'dialog:game-controllers' },
        { id: 'melaton-search', name: 'Indexing Options', art: 'indexing-options', cats: ['system'], tip: 'Change how Melaton indexes to enable faster searches.' },
        { id: 'internet-options', name: 'Internet Options', art: 'internet-options', cats: ['network', 'security'], tip: 'Configure your Internet display and connection settings.', open: 'dialog:internet-options' },
        { id: 'iscsi', name: 'iSCSI Initiator', art: 'iscsi-initiator', cats: ['system'], tip: 'Connect to remote iSCSI targets and configure connection settings.', open: 'dialog:iscsi' },
        { id: 'keyboard', name: 'Keyboard', art: 'keyboard', cats: ['hardware'], tip: 'Change keyboard settings, such as the cursor blink rate and the character repeat rate.', open: 'dialog:keyboard' },
        { id: 'mouse', name: 'Mouse', art: 'mouse', cats: ['hardware'], tip: 'Customize your mouse settings, such as the button configuration, double-click speed, mouse pointers, and motion speed.', open: 'dialog:mouse' },
        { id: 'network', name: 'Network and Server Center', art: 'network-and-sharing-center', cats: ['network'], tip: 'Check network status, change network settings and see the server status.' },
        { id: 'offline-files', name: 'Offline Files', art: 'offline-files', cats: ['network'], tip: 'Manage the files that are available offline.', open: 'dialog:offline-files' },
        { id: 'parental-controls', name: 'Parental Controls', art: 'parental-controls', cats: ['users', 'security'], tip: 'Set up Parental Controls for any user.', open: 'page:parental-controls' },
        { id: 'pen-and-input', name: 'Pen and Input Devices', art: 'pen-and-input-devices', cats: ['hardware'], tip: 'Configure pen and input device settings.', open: 'dialog:pen-and-input' },
        { id: 'people-near-me', name: 'People Near Me', art: 'people-near-me', cats: ['network'], tip: 'Change People Near Me settings.', open: 'dialog:people-near-me' },
        { id: 'performance', name: 'Performance Information and Tools', art: 'performance-information-and-tools', cats: ['system'], tip: "Rate your computer's performance and find tools to improve it.", open: 'page:performance' },
        { id: 'personalization', name: 'Personalization', art: 'personalization', cats: ['appearance', 'hardware'], tip: 'Personalize appearance and sounds.' },
        { id: 'phone-and-modem', name: 'Phone and Modem Options', art: 'phone-and-modem-options', cats: ['hardware'], tip: 'Configure your telephone dialing rules and modem properties.', open: 'dialog:phone-and-modem' },
        { id: 'power-options', name: 'Power Options', art: 'power-options', cats: ['hardware', 'system'], tip: 'Conserve energy or maximize performance by choosing how your computer manages power.', open: 'page:power-options' },
        { id: 'printers', name: 'Printers', art: 'printers', cats: ['hardware'], tip: 'Add, remove, and configure local and network printers.', open: 'page:printers' },
        { id: 'problem-reports', name: 'Problem Reports and Solutions', art: 'problem-reports-and-solutions', cats: ['system'], tip: 'Check online for solutions to problems with your computer.', open: 'page:problem-reports' },
        { id: 'programs', name: 'Programs and Features', art: 'programs-and-features', cats: ['programs'], tip: 'Uninstall or change programs on your computer.', open: 'page:programs' },
        { id: 'regional', name: 'Regional and Language Options', art: 'regional-and-language-options', cats: ['clock'], tip: 'Customize settings for the display of languages, numbers, times, and dates.', open: 'dialog:regional' },
        { id: 'scanners-and-cameras', name: 'Scanners and Cameras', art: 'scanners-and-cameras', cats: ['hardware'], tip: 'View and configure scanners and cameras.', open: 'page:scanners-and-cameras' },
        { id: 'security-center', name: 'Security Center', art: 'security-center', cats: ['security'], tip: "Check your computer's security status.", open: 'call:openSecurityCenter' },
        { id: 'sound', name: 'Sound', art: 'sound', cats: ['hardware'], tip: 'Configure your audio devices or change the sound scheme for your computer.' },
        { id: 'speech-recognition', name: 'Speech Recognition Options', art: 'speech-recognition-options', cats: ['access'], tip: 'Configure your computer to use speech recognition.', open: 'page:speech-recognition' },
        { id: 'sync-center', name: 'Sync Center', art: 'sync-center', cats: ['network'], tip: 'Sync files between your computer and network folders or other devices.', open: 'page:sync-center' },
        { id: 'system', name: 'System', art: 'system', cats: ['system'], tip: 'View basic information about your computer.' },
        { id: 'tablet-pc', name: 'Tablet PC Settings', art: 'tablet-pc-settings', cats: ['hardware'], tip: 'Configure tablet pen and screen settings.', open: 'dialog:tablet-pc' },
        { id: 'taskbar', name: 'Taskbar and Start Menu', art: 'taskbar-and-start-menu', cats: ['appearance'], tip: 'Customize the Start menu and the taskbar, such as the types of items to be displayed and how they should appear.' },
        { id: 'text-to-speech', name: 'Text to Speech', art: 'text-to-speech', cats: ['hardware'], tip: 'Change text-to-speech settings.', open: 'dialog:text-to-speech' },
        { id: 'user-accounts', name: 'User Accounts', art: 'user-accounts', cats: ['users'], tip: 'Change user account settings and passwords for people who share this computer.' },
        { id: 'welcome-center', name: 'Welcome Center', art: 'welcome-center', cats: ['system'], tip: 'Learn about your computer and get started with Melaton.', open: 'call:openWelcomeCenter' },
        { id: 'cardspace', name: 'Melaton CardSpace', art: 'cardspace', cats: ['users'], tip: 'Manage Information Cards that are used to log on to online services.', open: 'page:cardspace' },
        { id: 'windows-defender', name: 'Melaton Defender', art: 'defender', cats: ['programs', 'security'], tip: 'Scan for spyware and other potentially unwanted software.' },
        { id: 'firewall', name: 'Melaton Firewall', art: 'firewall', cats: ['network', 'security'], tip: 'Use a firewall to help prevent hackers or malicious software from gaining access to your computer.', open: 'page:firewall' },
        { id: 'sidebar-properties', name: 'Melaton Sidebar Properties', art: 'sidebar-properties', cats: ['appearance', 'programs'], tip: 'Configure Melaton Sidebar settings.', open: 'dialog:sidebar-properties' },
        { id: 'sideshow', name: 'Melaton SideShow', art: 'sideshow', cats: ['hardware', 'programs'], tip: 'Set up a secondary display to use with Melaton SideShow.', open: 'page:sideshow' },
        { id: 'meleton-update', name: 'Melaton Update', art: 'update', cats: ['system', 'security'], tip: 'Check for updates and change update settings.' },
        // Vista's Programs page has "Get Programs Online" (Windows Marketplace): Melaton sends it
        // to the Dreamscape services homepage. It is not a Classic View icon, as in Vista.
        { id: 'get-programs', name: 'Get Programs Online', art: 'programs-and-features', cats: [], hidden: true, tip: 'Get new programs online.', open: 'call:openDsapInGrimoire:dsap://dreamscape.jp/' },
        // Melaton's own
        { id: 'remote-access', cats: ['system', 'network'] },
        { id: 'mail', cats: ['users', 'additional'] },
        { id: 'runes', cats: ['system', 'additional'] },
        // Management Tools (the Dreamscape service pages) is listed in Administrative Tools
        { id: 'dreamscape-services', cats: ['system', 'additional'], hidden: true },
        { id: 'authentication', cats: ['users', 'additional'] },
        // Window Color and Appearance is Personalization's page in Vista, not an icon of its own
        { id: 'appearance', cats: ['appearance'], hidden: true }
    ];

    const ART = '/static_images/vista-cpl/items';

    function art(name, size) {
        if (!name) return '';
        if (name.startsWith('/')) return name;
        return `${ART}/${name}-${size}.png`;
    }

    function categoryArt(cat, size) {
        return `/static_images/vista-cpl/categories/${cat.art}-${size}.png`;
    }

    root.cplCatalog = { CATEGORIES, ITEMS, art, categoryArt };
})(typeof window !== 'undefined' ? window : globalThis);
