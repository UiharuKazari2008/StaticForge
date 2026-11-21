/**
 * Dynamic Feature and Asset Loader Core
 * Registers and asynchronously loads component scripts, styles, and HTML templates.
 */

// hot: true = updates live, no restart (#872; the hot-features note above class FeatureLoader). Set only
// for features `node scripts/check-app-scope.js --features` lists and that passed a live swap (loaded,
// swapped, old copy reclaimed, no exceptions; ~/.cache/claude-run/live-features.js).
const FEATURE_MANIFEST = {
    // the phone Device Center draws (#827): Device Center and the Sidebar's Mobile Device gadgets
    activesync_device_art: {
        hot: true,
        styles: ['css/activesync-device-art.css'],
        scripts: ['scripts/comp/activeSyncDeviceArt.js']
    },
    // the kit's tree list (#979): a list view whose rows open to child rows; its styles are in the kit
    // (vista-glass-controls.css). Device Center's notification settings; any window may load it
    vista_tree_list: {
        scripts: ['scripts/comp/vistaTreeList.js']
    },
    spellbook: {
        hot: true,
        html: 'templates/spellbook.html',
        styles: ['css/spellbook.css'],
        scripts: ['scripts/comp/spellbookModal.js']
    },
    notepad: {
        hot: true,
        // Find / Replace / Go To / Font / Page Setup are Vista's own templates (notepadVista.js)
        depends: ['vista_dialog_templates'],
        html: 'templates/notepad.html',
        styles: [
            'css/notepad.css',
            'css/spell-check.css',
            'css/autocomplete.css',
            'css/vista-atelier.css',
            'css/notepad-vista.css'
        ],
        scripts: [
            'scripts/comp/soundRecorder.js',
            'scripts/comp/journal.js',
            'scripts/comp/notepadManager.js',
            'scripts/comp/notepadVista.js'
        ]
    },
    chat: {
        hot: true,
        html: 'templates/chat.html',
        styles: ['css/chat-modal.css'],
        scripts: ['scripts/comp/chatSystem.js']
    },
    config_editor: {
        hot: true,
        html: 'templates/config-editor.html',
        styles: ['css/config-editor.css'],
        scripts: ['scripts/comp/configEditorApplet.js']
    },
    character_db: {
        hot: true,
        html: 'templates/character-db.html',
        styles: ['css/character-db-applet.css'],
        scripts: ['scripts/comp/characterDbApplet.js']
    },
    server_management: {
        hot: true,
        scripts: [
            'scripts/comp/serverManagement.js',
            'scripts/comp/ipManagement.js'
        ]
    },
    log_viewer: {
        hot: true,
        html: 'templates/log-viewer.html',
        depends: ['server_management'],
        styles: ['css/log-viewer.css', 'css/websocket-requests.css'],
        scripts: ['scripts/comp/websocketRequestsModal.js', 'scripts/comp/logViewerApplet.js']
    },
    run_index: {
        hot: true,
        scripts: ['scripts/comp/runCommandIndex.js']
    },
    run: {
        hot: true,
        html: 'templates/run.html',
        depends: ['run_index'],
        styles: ['css/run-applet.css'],
        scripts: ['scripts/comp/runApplet.js']
    },
    nax_vibes: {
        hot: true,
        scripts: ['scripts/comp/naxVibesApplet.js']
    },
    grimoire: {
        html: 'templates/grimoire.html',
        styles: ['css/tag-wiki-search.css', 'css/themes/vista/grimoire-extensions.css', 'css/themes/vista/grimoire-ie-pages.css'],
        scripts: ['scripts/comp/grimoireRemoteBrowser.js', 'scripts/comp/grimoireIeChrome.js', 'scripts/comp/grimoireTabs.js', 'scripts/comp/tagWikiSearchModal.js', 'scripts/comp/grimoireHistoryDsap.js']
    },
    character_search: {
        hot: true,
        depends: ['grimoire'],
        scripts: ['scripts/comp/characterSearchModal.js']
    },
    explorer: {
        hot: true,
        styles: ['css/explorer.css', 'css/vista-file-progress.css', 'css/vista-7zip.css', 'css/themes/vista/filetypes.css', 'css/melaton-apps.css', 'css/themes/vista/explorer-contacts.css', 'css/explorer-contacts.css', 'css/explorer-phone.css'],
        // vfsClient / vfsVirtualGrid / routers stay sync — desktop + inbound use them without Cartograph
        scripts: ['scripts/comp/explorerVistaChrome.js', 'scripts/comp/explorerComputerView.js', 'scripts/comp/fileOperationProgress.js', 'scripts/comp/vfsPrograms.js', 'scripts/comp/explorerArchive.js', 'scripts/comp/explorerSequenzia.js', 'scripts/comp/vcard.js', 'scripts/comp/explorerContacts.js', 'scripts/comp/phoneStorageBridge.js', 'scripts/comp/explorerPhoneDrive.js', 'scripts/comp/explorerHostDrive.js', 'scripts/comp/explorerNetwork.js', 'scripts/comp/explorerApplet.js']
    },
    // 7-Zip's dialogs and progress window (explorerArchive.js): Taskbar Properties' Vista controls (tbp-*)
    seven_zip_dialogs: {
        styles: ['css/taskbar-properties.css']
    },
    naxt: {
        html: 'templates/naxt.html',
        styles: ['css/naxt-shell.css', 'css/spellbook.css', 'css/vista-atelier.css'],
        scripts: ['scripts/comp/naxtVistaChrome.js', 'scripts/comp/naxtApplet.js']
    },
    bracket_gen: {
        html: 'templates/bracket-generation.html',
        styles: ['css/bracket-generation.css'],
        scripts: ['scripts/comp/bracketGenerationApplet.js']
    },
    dataset_tag_toolbar: {
        hot: true,
        scripts: ['scripts/comp/datasetTagToolbar.js']
    },
    compiled_prompt_inspector: {
        hot: true,
        styles: ['css/compiled-prompt-lcd.css'],
        scripts: ['scripts/comp/compiledPromptInspector.js']
    },
    // Melaton Photo Gallery's gallery (Windows Photo Gallery, #446): the library, its sources and the shared Info pane
    glancewell_library: {
        styles: ['css/themes/vista/glancewell-library.css', 'css/themes/vista/glancewell-fix.css', 'css/themes/vista/glancewell-show.css'],
        scripts: ['scripts/comp/glancewellSources.js', 'scripts/comp/glancewellLibrary.js', 'scripts/comp/glancewellFix.js', 'scripts/comp/glancewellThemes.js', 'scripts/comp/glancewellVideo.js']
    },
    image_prompt_inspector: {
        hot: true,
        html: 'templates/image-prompt-inspector.html',
        // vista-atelier.css: the Vista menu bar; compiled-prompt-lcd.css: the Property / Value list
        // and the scene cards of the Dynamic Generation section
        styles: ['css/image-prompt-inspector.css', 'css/vista-atelier.css', 'css/compiled-prompt-lcd.css'],
        scripts: ['scripts/comp/imagePromptInspector.js']
    },
    tag_sets: {
        scripts: ['scripts/comp/tagSets.js']
    },
    planet_switcher: {
        hot: true,
        styles: ['css/planet-switcher.css'],
        scripts: ['scripts/comp/planetSwitcher.js']
    },
    // Calculator moved to a Melaton app package (apps/calculator, Yozora #642): launch it with
    // melatonApps.launch({ packageId: 'calculator' }), not featureLoader.
    // Character Map (Yozora #632): charmap.exe; its window is the .mui's own dialog template
    charmap: {
        hot: true,
        depends: ['vista_dialog_templates'],
        styles: ['css/vista-charmap.css'],
        scripts: ['scripts/comp/desktop-apps/charmap/charmapApp.js']
    },
    // Device Simulator for Melaton SideShow (Yozora #655): VirtualSideShow.exe, a real SideShow device
    sideshow_simulator: {
        hot: true,
        styles: ['css/vista-sideshow-simulator.css'],
        scripts: ['scripts/comp/desktop-apps/sideshow/sideshowSimulator.js']
    },
    // Paint (Yozora #632): mspaint.exe with layers; its dialogs are Vista's own templates
    paint: {
        hot: true,
        depends: ['vista_dialog_templates'],
        // the menu bar is Notepad's (vista-atelier.css)
        styles: ['css/vista-atelier.css', 'css/vista-paint.css'],
        scripts: [
            'scripts/comp/desktop-apps/paint/paintCore.js',
            'scripts/comp/desktop-apps/paint/paintApp.js',
            'scripts/comp/desktop-apps/paint/paintLayers.js',
            'scripts/comp/desktop-apps/paint/paintDialogs.js',
            'scripts/comp/desktop-apps/paint/paintPro.js',
            'scripts/comp/desktop-apps/paint/paintColor.js',
            'scripts/comp/desktop-apps/paint/paintGsd.js',
            'scripts/comp/desktop-apps/paint/paintPsd.js',
            'scripts/comp/desktop-apps/paint/paintBar.js',
            'scripts/comp/desktop-apps/paint/paintType.js',
            'scripts/comp/desktop-apps/paint/paintBrush.js',
            'scripts/comp/desktop-apps/paint/paintSmart.js',
            'scripts/comp/desktop-apps/paint/paintPath.js',
            'scripts/comp/desktop-apps/paint/paintComps.js',
            'scripts/comp/desktop-apps/paint/paintWarp.js',
            'scripts/comp/desktop-apps/paint/paintActions.js',
            'scripts/comp/desktop-apps/paint/paintGenerate.js',
            'scripts/comp/desktop-apps/paint/paintPrefs.js'
        ]
    },
    media_player: {
        hot: true,
        styles: ['css/themes/vista/media-player.css', 'css/desktop-apps/mediaPlayer.css', 'css/desktop-apps/mediaPlayerAudio.css'],
        scripts: ['scripts/comp/desktop-apps/mediaPlayer.js', 'scripts/comp/desktop-apps/mediaPlayerAudio.js', 'scripts/comp/desktop-apps/mediaPlayerViz.js', 'scripts/comp/desktop-apps/mediaPlayerVizBattery.js', 'scripts/comp/desktop-apps/mediaPlayerVizAlchemy.js']
    },
    // Alarm Clock moved to a Melaton app package (apps/alarm, Yozora #642):
    // melatonApps.launch({ packageId: 'alarm' }) (args { mode: 'pomodoro' } for the Pomodoro tab).
    remote_desktop: {
        hot: true,
        scripts: ['scripts/comp/desktop-apps/guacRemote.js']
    },
    // Remote Desktop Connection: Vista's mstsc dialog; sessions open in remote_desktop's window
    remote_desktop_connection: {
        hot: true,
        depends: ['remote_desktop'],
        styles: ['css/taskbar-properties.css', 'css/desktop-apps/remoteDesktopConnection.css'],
        scripts: ['scripts/comp/desktop-apps/remoteDesktopConnection.js']
    },
    emotion: {
        hot: true,
        styles: ['css/desktop-apps/emotion.css'],
        scripts: ['scripts/comp/desktop-apps/emotion.js']
    },
    // Windows Vista's games (Yozora #609): the shared engine, then one feature per game
    vista_games: {
        hot: true,
        styles: ['css/desktop-apps/vista-games.css'],
        scripts: ['scripts/comp/desktop-apps/vista-games/vistaGameEngine.js']
    },
    vista_minesweeper: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/minesweeper.js']
    },
    vista_cards: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/cardEngine.js']
    },
    vista_solitaire: {
        hot: true,
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/solitaire.js']
    },
    vista_spider: {
        hot: true,
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/spider.js']
    },
    vista_freecell: {
        hot: true,
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/freecell.js']
    },
    vista_hearts: {
        hot: true,
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/hearts.js']
    },
    vista_mahjong: {
        hot: true,
        depends: ['vista_cards'],
        scripts: ['scripts/comp/desktop-apps/vista-games/mahjong.js']
    },
    vista_chess: {
        hot: true,
        depends: ['vista_games'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/chessEngine.js',
            'scripts/comp/desktop-apps/vista-games/chessRender.js',
            'scripts/comp/desktop-apps/vista-games/chess.js'
        ]
    },
    vista_inkball: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/inkball.js']
    },
    // Hosted Sidebar gadgets (Yozora #629): loaded by vistaSidebar.js when a gadget from public/static_images/vista-gadgets/catalog.json shows
    vista_gadget_host: {
        hot: true,
        styles: ['css/vista-gadget-host.css'],
        scripts: ['scripts/comp/vistaGadgetHost.js']
    },
    vista_purble: {
        hot: true,
        // vista_cards for its status bar (VG.Cards.statusBar)
        depends: ['vista_cards'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/purbleRules.js',
            'scripts/comp/desktop-apps/vista-games/purble.js',
            'scripts/comp/desktop-apps/vista-games/purblePairs.js',
            'scripts/comp/desktop-apps/vista-games/purbleCakes.js',
            'scripts/comp/desktop-apps/vista-games/purbleShop.js'
        ]
    },
    vista_blockdrop: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/blockdrop.js']
    },
    vista_brickbreaker: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/brickbreaker.js']
    },
    // Doubles (#836): a Melaton slide-and-join number puzzle; draws itself, no pack
    vista_doubles: {
        hot: true,
        depends: ['vista_games'],
        scripts: ['scripts/comp/desktop-apps/vista-games/doubles.js']
    },
    // JezzBall (Win 3.x Entertainment Pack): a 16-bit program's classic window on the Vista desktop
    vista_jezzball: {
        hot: true,
        depends: ['vista_games'],
        styles: ['css/desktop-apps/vista-jezzball.css'],
        scripts: [
            'scripts/comp/desktop-apps/vista-games/jezzballReal.js',
            'scripts/comp/desktop-apps/vista-games/jezzballCore.js',
            'scripts/comp/desktop-apps/vista-games/jezzballHelp.js',
            'scripts/comp/desktop-apps/vista-games/jezzball.js'
        ]
    },
    vista_explorer: {
        hot: true,
        depends: ['vista_games'],
        styles: ['css/desktop-apps/vista-games-explorer.css'],
        scripts: ['scripts/comp/desktop-apps/vista-games/gamesExplorer.js']
    },
    start_menu_organizer: {
        hot: true,
        scripts: ['scripts/comp/desktop-apps/startMenuOrganizer.js']
    },
    // Desktop Icon Settings and Change Icon (Personalize, a desktop shortcut's Change Icon...);
    // drawn with Taskbar Properties' Vista controls (tbp-*)
    desktop_icon_dialogs: {
        hot: true,
        styles: ['css/taskbar-properties.css', 'css/desktop-icon-dialogs.css'],
        scripts: ['scripts/comp/desktopIconDialogs.js']
    },
    // Dovecote's windows (#1001): the main window, the reader and New Message windows, attachments
    // (dovecoteWindow.js). desktop-apps/dovecote.js keeps the tray, its badge and flyout, the balloons and the
    // mailbox pushes at boot, and its openers (doveUi) load this
    dovecote: {
        stylesFirst: true,
        styles: ['css/desktop-apps/dovecote.css'],
        scripts: ['scripts/comp/desktop-apps/dovecoteWindow.js']
    },
    // Melaton Weather's desktop window (#1001): the phone's Weather (wmWeather.js) in a Vista window. Melaton Mobile
    // runs it from the boot (Today, the 6.5 home screen, the status bar); the desktop loads it on the first open
    // (melatonWeatherOpener.js stands in for window.wmWeather until then)
    melaton_weather: {
        stylesFirst: true,
        styles: ['css/wm-weather.css'],
        scripts: ['scripts/comp/wmWeather.js']
    },
    // Dovecote Express's Tools > Options (and Control Panel's Mail item): drawn with Taskbar
    // Properties' Vista controls (tbp-*); desktop-apps/dovecote.js openDovecoteMailOptions
    mail_options: {
        hot: true,
        styles: ['css/taskbar-properties.css', 'css/mail-options.css'],
        scripts: ['scripts/comp/mailOptions.js']
    },
    // window pictures for Flip 3D and the taskbar's window previews (taskbarSettings.js)
    window_capture: {
        hot: true,
        scripts: ['scripts/comp/windowCapture.js']
    },
    // Melaton Bars (#871): the phone's title / soft key bars copied for the Android app to draw over other programs
    melaton_bars: {
        hot: true,
        depends: ['window_capture'],
        scripts: ['scripts/comp/melatonBars.js']
    },
    // Windows Flip 3D, Vista's Win+Tab (keyboardShortcuts.js, taskbarSettings.js Quick Launch)
    flip3d: {
        hot: true,
        depends: ['window_capture'],
        styles: ['css/flip3d.css'],
        scripts: ['scripts/comp/flip3d.js']
    },
    // Taskbar and Start Menu Properties (public/scripts/comp/taskbarSettings.js openProperties)
    taskbar_properties: {
        hot: true,
        styles: ['css/taskbar-properties.css'],
        scripts: ['scripts/comp/taskbarProperties.js']
    },
    // the device's own CPU / memory / processes on a device client (Yozora #946): Task Manager, Performance
    // Monitor, the Sidebar's CPU Meter and hosted gadgets read it instead of the server's figures
    device_perf: {
        scripts: ['scripts/comp/devicePerf.js']
    },
    // Vista's own dialog templates and their renderer (Yozora #632): Control Panel's sheets,
    // Notepad's and Paint's dialogs draw from these
    vista_dialog_templates: {
        styles: ['css/taskbar-properties.css', 'css/vista-dialog-template.css'],
        scripts: ['scripts/comp/vistaDialogTemplates.js', 'scripts/comp/vistaDialogTemplate.js']
    },
    // Sharing a folder on a DreamOS computer (#910): the File Sharing wizard, the folder's Properties (General, Sharing),
    // Advanced Sharing and Share Permissions (vistaFileSharing.js; explorerHostDrive.js and explorerNetwork.js open them)
    vista_file_sharing: {
        hot: true,
        depends: ['vista_dialog_templates'],
        scripts: ['scripts/comp/vistaFileSharing.js']
    },
    // DreamOS's wireless and network windows (#910, #932; dreamosWifi.js): Connect to a network, Manage Wireless
    // Networks, the status sheets, Network Connections, Set up a connection or network. Loaded on the first open
    // (dreamosWifiBoot.js answers for window.dreamosWifi until then, #1001) and with Control Panel
    dreamos_wifi: {
        scripts: ['scripts/comp/dreamosWifi.js']
    },
    // Vista's VPN connections (#952): Connect to a workplace, Connect <name>, its Properties (dreamosVpn.js, from dreamosWifi.js)
    network_vpn: {
        depends: ['vista_dialog_templates'],
        scripts: ['scripts/comp/dreamosVpn.js']
    },
    // Restore Session, Browsing Session Settings, Other Devices (#756; browsingRestore.js, browsingOtherDevices.js at boot)
    browsing_sessions_ui: {
        depends: ['vista_dialog_templates'],
        styles: ['css/browsing-sessions.css']
    },
    // Make Global (Yozora #668): embedded (request body) expanders saved as global ones, an Aero Wizard
    expander_make_global: {
        hot: true,
        depends: ['vista_dialog_templates'],
        styles: ['css/expander-make-global.css'],
        scripts: ['scripts/comp/expanderMakeGlobalWizard.js']
    },
    // DreamOS: the domain controller's last known address (#910; dreamosServerAddress.js, the Server tab of the
    // Nightshade adapter's Properties in cplDeviceManager.js; the host keeps the addresses, CaféReady serveraddr.rs)
    dreamos_server_address: {
        depends: ['vista_dialog_templates'],
        styles: ['css/dreamos-server-address.css'],
        scripts: ['scripts/comp/dreamosServerAddress.js']
    },
    // DreamOS firmware updates (#910): the OS base and CaféReady's components - Melaton Update, Control Panel >
    // Firmware and the shut down screen (serviceWorkerManager.installUpdatesAtShutdown) load it
    dreamos_firmware: {
        // swaps live (#951: check-app-scope --features finds it eligible - no globals other files use)
        hot: true,
        scripts: ['scripts/comp/dreamosFirmware.js']
    },
    // Vista's Volume Mixer (sndvol, #980): the tray volume menu's Open Volume Mixer, the flyout's Mixer link and
    // Control Panel's Adjust system volume (tabVolume.openMixer)
    volume_mixer: {
        styles: ['css/themes/vista/volume-mixer.css', 'css/volume-mixer.css'],
        scripts: ['scripts/comp/volumeMixer.js']
    },
    control_panel: {
        hot: true,
        // dreamos_wifi (#1001): the network pages and the tray's network flyout read window.dreamosWifi as they draw
        depends: ['vista_dialog_templates', 'dreamos_firmware', 'dreamos_wifi'],
        // Remote Access Properties draws with Taskbar Properties' Vista controls (tbp-*)
        styles: ['css/desktop-settings.css', 'css/vista-defender.css', 'css/cpl-system.css',
            'css/taskbar-properties.css', 'css/remote-access-properties.css', 'css/cpl-personalization.css',
            'css/cpl-catalog.css', 'css/cpl-dialogs.css', 'css/cpl-pages.css', 'css/cpl-pages2.css',
            'css/welcome-center.css', 'css/cpl-cardspace.css', 'css/cpl-indexing.css', 'css/dpi-scaling.css',
            // Melaton Mobility Center (#932): the Vista theme's colours and art, then the layout
            'css/themes/vista/mobility-center.css', 'css/mobility-center.css',
            // Presentation Settings (#958): the Vista theme's colours, then the layout
            'css/themes/vista/presentation-settings.css', 'css/presentation-settings.css',
            // Disk Cleanup's list (#945, diskCleanup.js)
            'css/disk-cleanup.css',
            // Device Manager: the Vista theme's colours (the Disable question's instruction, the combo list's shadow)
            'css/themes/vista/device-manager.css'],
        scripts: [
            // Vista's items, categories and task links (Yozora #632), read by melatonControlPanel.js
            'scripts/comp/cplCatalog.js',
            'scripts/comp/melatonControlPanel.js',
            'scripts/comp/experienceIndex.js',
            'scripts/comp/cplSystem.js',
            // this computer's storage: Disk Cleanup, Offline Files' Disk Usage, Sync Center (#945)
            'scripts/comp/diskCleanup.js',
            'scripts/comp/remoteAccessProperties.js',
            'scripts/comp/cplAuthentication.js',
            'scripts/comp/cplUpdate.js',
            // Firmware (DreamOS, #910): the system agent, the OS base and its A/B slots, the machine's firmware
            'scripts/comp/cplFirmware.js',
            'scripts/comp/cplUserAccounts.js',
            'scripts/comp/windowsDefender.js',
            'scripts/comp/cplSearch.js',
            'scripts/comp/cplMail.js',
            // the photo galleries' list and credits, read by Desktop Background
            'scripts/comp/wallpaperGalleries.js',
            'scripts/comp/cplDesktopBackground.js',
            // DPI Scaling (DreamOS, #910): Personalization's "Adjust font size (DPI)"
            'scripts/comp/dpiScalingDialog.js',
            // Personalization's hub and Window Color page, then the Screen Saver and Sound dialogs
            'scripts/comp/cplPersonalization.js',
            // (Sound's devices, audioDevices.js, load with the page: the tray volume menu lists the outputs, #963)
            'scripts/comp/personalizationDialogs.js',
            // Vista's other items: the property sheets, then the pages (Yozora #632)
            'scripts/comp/cplDialogs.js',
            'scripts/comp/cplDialogs2.js',
            // Internet Properties' own dialogs, driving Grimoire and Alchemy
            'scripts/comp/cplInternetOptions.js',
            'scripts/comp/cplPages.js',
            'scripts/comp/cplPages2.js',
            'scripts/comp/cplPages3.js',
            'scripts/comp/cplDeviceManager.js',
            // Melaton Mobility Center (#932): Vista's mblctr, the Control Panel item 'mobility-center'
            'scripts/comp/mobilityCenter.js',
            // Presentation Settings (#958): PresentationSettings.exe; the state is melatonPresentation.js (boot)
            'scripts/comp/presentationSettings.js'
        ]
    },
    // Image Search's search library (#831): the retired Global Search DSAP's helpers and sessions
    // (omegasearchDsap*, OMEGASEARCH_*), used by Image Search, the phone's Search Pictures (wmSearchPictures.js)
    image_search_lib: {
        scripts: ['scripts/comp/omegasearchDsapApplet.js']
    },
    // Image Search (Yozora #828), the desktop program that replaced the Global Search DSAP
    image_search: {
        hot: true,
        // vista_dialog_templates: the date pickers of the advanced pane
        depends: ['image_search_lib', 'vista_dialog_templates'],
        styles: ['css/image-search.css'],
        scripts: ['scripts/comp/imageSearchApp.js']
    },
    // Computer Management's library (#831): the retired Data Management DSAP's replication pages, account
    // helpers and driver (dataMgmtDsap*, replication*), hosted by mmcDataManagement.js
    data_mgmt_lib: {
        styles: ['css/replication-dsap.css'],
        scripts: [
            'scripts/comp/dataManagementDsapApplet.js',
            'scripts/comp/replicationDsapSeparation.js',
            'scripts/comp/replicationDsapCargo.js',
            'scripts/comp/replicationDsapSync.js'
        ]
    },
    // Melaton Defender's and Dreamscape CardSpace's library (#831): the retired Security Center DSAP's
    // markup and driver (securityDsap*), run by windowsDefender.js and cplAuthentication.js
    security_center_lib: {
        hot: true,
        scripts: ['scripts/comp/securityCenterDsapApplet.js']
    },
    // Workspace Properties, New / Rename / Dump Workspace, Reorder Partitions on the desktop (#828):
    // workspaceUtils.js opens them; Data Management's Workspace Management uses them too
    workspace_dialogs: {
        hot: true,
        depends: ['vista_dialog_templates'],
        styles: ['css/workspace-dialogs.css'],
        scripts: ['scripts/comp/workspaceDialogs.js']
    },
    // The MMC consoles that replaced the management DSAPs (Yozora #828): the shell, then the snap-ins
    mmc_snapins: {
        hot: true,
        depends: ['vista_dialog_templates', 'workspace_dialogs', 'print_queue'],
        styles: ['css/mmc-console.css', 'css/mmc-frontgate.css', 'css/mmc-quips-autofill.css', 'css/mmc-enshutsuka.css', 'css/mmc-datamgmt.css', 'css/mmc-books.css', 'css/mmc-wiki.css', 'css/mmc-chardb.css', 'css/mmc-exchange.css', 'css/mmc-appkeys.css', 'css/mmc-servermgr.css'],
        scripts: [
            'scripts/comp/mmcConsole.js',
            'scripts/comp/mmcFrontGate.js',
            'scripts/comp/mmcQuips.js',
            'scripts/comp/mmcAutofillRanking.js',
            'scripts/comp/mmcEnshutsuka.js',
            'scripts/comp/mmcSpellbook.js',
            'scripts/comp/mmcExpanders.js',
            'scripts/comp/mmcCharacterDb.js',
            'scripts/comp/mmcWikiManager.js',
            'scripts/comp/mmcExchange.js',
            'scripts/comp/mmcAppKeys.js',
            'scripts/comp/mmcDataManagement.js',
            'scripts/comp/mmcPrintManagement.js',
            // Server Manager hosts the consoles above: after them
            'scripts/comp/mmcServerManager.js'
        ]
    },
    // Print queue windows (#831): one per printer (generation backend); the tray icon is printQueue.js
    print_queue: {
        hot: true,
        depends: ['vista_dialog_templates'],
        styles: ['css/print-queue.css'],
        scripts: ['scripts/comp/printQueueWindow.js']
    },
    // Director add-ons loaded on demand by director.js (setupMascot / openToolPayload); styles stay in director.css.
    director_mascot: {
        hot: true,
        scripts: ['scripts/comp/directorMascot.js']
    },
    director_mascot_lab: {
        hot: true,
        scripts: ['scripts/comp/directorMascotLab.js']
    },
    director_tool_inspector: {
        hot: true,
        scripts: ['scripts/comp/directorToolInspector.js']
    }
};

/*
 * Hot features (Yozora #872): a FEATURE_MANIFEST entry with hot: true loads its scripts as a Melaton
 * segment (melatonSegments.js), each in a function scope of its own, and its template markup is owned
 * by that segment. An update to its scripts or template then swaps it without a restart
 * (swapFeature: unload, load again; it waits while one of its windows is open). Its styles stay
 * ordinary page stylesheets (features share them); CSS updates apply live anyway.
 * A feature may be marked hot only when `node scripts/check-app-scope.js --features` lists it: no other
 * file (nor another of its own scripts, nor its template) uses a name it puts on the page implicitly,
 * nothing depends on it, it overrides nothing shared.
 */
class FeatureLoader {
    // the longest a program waits for its files' version names before it loads the kept copy by path (_versionedAssetUrl)
    static HASH_WAIT_MS = 1500;
    // the longest a stylesFirst feature waits for its stylesheets (stylesLoaded)
    static STYLE_WAIT_MS = 3000;
    // programs whose "cannot open" box is on screen (tellCannotOpen)
    static cannotOpenShown = new Set();

    constructor() {
        this.loadedFeatures = new Set();
        this.loadingPromises = new Map();
        // hot features whose update waits for their windows to close
        this.pendingSwaps = new Set();
    }

    isHot(name) {
        const f = FEATURE_MANIFEST[name];
        return !!(f && (f.hot === true || this._trialHot().has(name)) && window.melatonSegments);
    }

    /**
     * Test tabs only: localStorage melatonHotTrial = 'a,b' loads those features as segments from the
     * first load on (features loaded at boot cannot be switched later), to try them before hot: true.
     */
    _trialHot() {
        if (!this._trial) {
            let raw = '';
            try { raw = localStorage.getItem('melatonHotTrial') || ''; } catch (_) { raw = ''; }
            this._trial = new Set(raw.split(',').map((x) => x.trim()).filter(Boolean));
        }
        return this._trial;
    }

    /** The loaded hot feature a static file belongs to (a script or its template), else null. */
    hotFeatureOf(pathname) {
        const rel = String(pathname || '').replace(/^\/+/, '');
        for (const name of this.loadedFeatures) {
            if (!this.isHot(name)) continue;
            const f = FEATURE_MANIFEST[name];
            if ((f.scripts || []).includes(rel) || f.html === rel) return name;
        }
        return null;
    }

    /** Unload a loaded hot feature (its code, globals, listeners, markup). Returns what was released. */
    unloadFeature(name, reason) {
        if (!this.isHot(name) || !this.loadedFeatures.has(name)) return null;
        const released = window.melatonSegments.unload(`feature:${name}`, reason || 'unload');
        this.loadedFeatures.delete(name);
        return released;
    }

    /**
     * Swap a loaded hot feature for the code in the cache (after an update): unload it and load it
     * again. Waits (pendingSwaps) while one of its windows is on screen.
     */
    /** Loaded features that depend on name, directly or through others, dependents last. */
    _loadedDependents(name) {
        const out = [];
        const visit = (n) => {
            for (const [k, f] of Object.entries(FEATURE_MANIFEST)) {
                if (!(f.depends || []).includes(n) || !this.loadedFeatures.has(k) || out.includes(k)) continue;
                out.push(k);
                visit(k);
            }
        };
        visit(name);
        return out;
    }

    async swapFeature(name, opts = {}) {
        if (!this.isHot(name)) return { notHot: true };
        if (this.loadingPromises.has(name)) { try { await this.loadingPromises.get(name); } catch (_) { /* swapped anyway */ } }
        if (!this.loadedFeatures.has(name)) return { notLoaded: true };
        // a feature others depend on goes with them: they hold its exports (the games hold the engine)
        const dependents = this._loadedDependents(name);
        if (dependents.some((d) => !this.isHot(d))) {
            // check-app-scope --features keeps this from being marked hot; never swap it under cold code
            return { blocked: `depended on by ${dependents.filter((d) => !this.isHot(d)).join(', ')}` };
        }
        const wins = [name, ...dependents].flatMap((n) => window.melatonSegments.windowsOf(`feature:${n}`));
        const sw = window.serviceWorkerManager;
        if (!opts.force && wins.length) {
            this.pendingSwaps.add(name);
            this._watchPendingSwaps();
            // the program's own name for the history and the balloon: its window's caption
            if (!this.swapTitles) this.swapTitles = new Map();
            this.swapTitles.set(name, this._featureTitle(name, wins[0]));
            if (sw && typeof sw.noteUpdateWaiting === 'function') sw.noteUpdateWaiting(`feature:${name}`, this.swapTitles.get(name));
            return { deferred: 'window open' };
        }
        this.pendingSwaps.delete(name);
        const title = (this.swapTitles && this.swapTitles.get(name)) || this._featureTitle(name, wins[0]);
        if (this.swapTitles) this.swapTitles.delete(name);
        // dependents first (they use the feature), then the feature; load back in the other order
        for (const d of dependents.slice().reverse()) this.unloadFeature(d, 'update');
        const released = this.unloadFeature(name, 'update');
        await this.loadFeature(name);
        for (const d of dependents) await this.loadFeature(d);
        if (sw && typeof sw.noteUpdateInstalled === 'function') sw.noteUpdateInstalled(`feature:${name}`, title);
        try { document.dispatchEvent(new CustomEvent('melaton:feature-updated', { detail: { feature: name } })); } catch (_) { /* no listeners */ }
        return { swapped: true, released };
    }

    /** A feature's name for people: its window's caption, else the manifest key in words. */
    _featureTitle(name, win) {
        const cap = win && win.querySelector('.modal-window-title span, .modal-window-title');
        const t = cap && cap.textContent ? cap.textContent.trim() : '';
        if (t) return t.slice(0, 60);
        return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    _watchPendingSwaps() {
        if (this._pendingWatch) return;
        this._pendingWatch = true;
        // app-scope: allow page lifetime (the feature loader lives as long as the page)
        document.addEventListener('staticforge:modal-lifecycle', (e) => {
            if (!e.detail || e.detail.type !== 'closed' || !this.pendingSwaps.size) return;
            // after the closing window's own lifecycle handlers
            setTimeout(() => {
                for (const name of Array.from(this.pendingSwaps)) {
                    const all = [name, ...this._loadedDependents(name)];
                    if (!all.some((n) => window.melatonSegments.windowsOf(`feature:${n}`).length)) void this.swapFeature(name);
                }
            }, 50);
        });
    }

    /**
     * Dynamically loads a feature's CSS, HTML templates, and JS scripts.
     * @param {string} name - Name of the feature in the manifest
     * @returns {Promise<boolean>}
     */
    /**
     * A feature's windows, from its template file, as the last children of <body> (#817: the
     * markup of on-demand features lives in templates/*.html, not in app.html).
     * A top-level element whose id the page already has is left out: a page from before the markup
     * moved still carries that window, and two of one id would break every lookup.
     * Each window is handed to the taskbar's class observer (modalUtils.js observeModals), which
     * only knew the windows present at boot.
     */
    _insertFeatureMarkup(htmlText) {
        const holder = document.createElement('template');
        holder.innerHTML = htmlText;
        const added = [];
        Array.from(holder.content.children).forEach((el) => {
            if (el.id && document.getElementById(el.id)) { el.remove(); return; }
            added.push(el);
        });
        document.body.appendChild(holder.content);
        this._lastMarkup = added;
        // a window can bring a request badge of its own (the log viewer's): websocket.js looks its
        // kept list of badges up again (updateTickerBadge)
        if (window.wsClient) window.wsClient._tickerBadges = null;
        if (typeof window.observeTaskbarModal === 'function') {
            added.forEach((el) => { if (el.classList.contains('modal')) window.observeTaskbarModal(el); });
        }
    }

    async loadFeature(name) {
        if (this.loadedFeatures.has(name)) return true;
        if (this.loadingPromises.has(name)) return this.loadingPromises.get(name);

        const promise = this._loadFeatureNow(name).catch((err) => {
            // a load that failed is not kept: the next click tries again (it was kept for good, so a program that
            // could not load while the server was away never opened again until a restart)
            if (this.loadingPromises.get(name) === promise) this.loadingPromises.delete(name);
            if (FeatureLoader.unreachable(err) && !(err && err.melatonShown)) FeatureLoader.tellCannotOpen(name, err);
            throw err;
        });

        this.loadingPromises.set(name, promise);
        return promise;
    }

    async _loadFeatureNow(name) {
        {
            const feature = FEATURE_MANIFEST[name];
            if (!feature) {
                console.warn(`Feature loader: unknown feature "${name}"`);
                return false;
            }

            if (Array.isArray(feature.depends)) {
                for (const dep of feature.depends) {
                    await this.loadFeature(dep);
                }
            }

            console.log(`📦 Loading feature "${name}"...`);

            // 1. Inject Stylesheets. stylesFirst: a program that was on the page from the boot until it moved here
            // (#1001) draws its window only once its styles are in, as it did then (no unstyled first frame)
            if (Array.isArray(feature.styles)) {
                const links = [];
                for (const style of feature.styles) {
                    links.push(await this._injectStylesheet(style));
                }
                if (feature.stylesFirst) await FeatureLoader.stylesLoaded(links);
            }

            // 2. Inject HTML Template Markup
            if (feature.html) {
                try {
                    const htmlText = await fetch(`/${feature.html}`).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    });
                    this._insertFeatureMarkup(htmlText);
                } catch (err) {
                    console.error(`❌ Failed to load HTML template for "${name}":`, err);
                    throw err;
                }
            }

            // 3. Scripts. A hot feature (#872): one segment for its scripts, owning its markup
            if (this.isHot(name) && Array.isArray(feature.scripts) && feature.scripts.length) {
                const key = `feature:${name}`;
                const markup = feature.html ? (this._lastMarkup || []) : [];
                this._lastMarkup = null;
                const urls = await Promise.all(feature.scripts.map((s) => this._versionedAssetUrl(s)));
                const ready = window.melatonSegments.load({ key, label: name, scripts: urls, urlPrefixes: urls.map((u) => u.split('?')[0]), dependsOn: (feature.depends || []).map((d) => `feature:${d}`) });
                markup.forEach((el) => window.melatonSegments.adopt(key, el));
                await ready;
            } else if (Array.isArray(feature.scripts)) {
                for (const script of feature.scripts) {
                    await this._loadScript(script);
                }
            }

            this.loadedFeatures.add(name);
            this.loadingPromises.delete(name);
            console.log(`✅ Feature "${name}" successfully loaded.`);
            // for code that waits on a feature's classes without loading it (browsingRestore.js): an event, not a poll (#998)
            try { document.dispatchEvent(new CustomEvent('melaton:feature-loaded', { detail: { feature: name } })); } catch (_) { /* no listeners */ }
            return true;
        }
    }

    /** A load that failed because a file did not come (no server, no copy kept), not because its code is broken. */
    static unreachable(err) {
        const m = String((err && err.message) || err || '');
        return (err instanceof TypeError && /fetch|network/i.test(m)) || /did not load|Failed to load script|HTTP \d{3}/.test(m);
    }

    /**
     * A program that could not load says so, as Vista does when a program's files cannot be reached, instead of doing
     * nothing (Yukimi, Nov 20 2026: clicks on the Mac "won't open" while the server was away). One box per program at
     * a time; the error is marked shown so the page's error handler (fatalErrorBootstrap.js) does not add "has stopped
     * working" for a caller that did not catch it.
     */
    static tellCannotOpen(name, err) {
        if (err && typeof err === 'object') err.melatonShown = true;
        const shown = FeatureLoader.cannotOpenShown;
        if (shown.has(name) || typeof window.showConfirmationDialog !== 'function') return;
        shown.add(name);
        const title = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const offline = !(window.wsClient && typeof window.wsClient.isConnected === 'function' && window.wsClient.isConnected());
        const why = offline
            ? 'Melaton cannot reach the server, and this program is not on this computer yet.'
            : 'One of its files did not load.';
        Promise.resolve(window.showConfirmationDialog(
            `<p>${title} cannot open.</p><p>${why} Check your network connection, and then try again.</p>`,
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title, icon: 'fas fa-circle-xmark' }
        )).catch(() => {}).then(() => shown.delete(name));
    }

    isLoaded(name) {
        return this.loadedFeatures.has(name);
    }

    async _versionedAssetUrl(src) {
        const clean = src.startsWith('/') ? src : `/${src}`;
        const pathOnly = clean.split('?')[0];
        let hash = null;
        // hashForStaticPath: public/scripts/comp/serviceWorkerManager.js
        // It answers from the cache's own row; only a file the cache has no hash for asks the server for the file list
        // (up to 30 s). A program never waits for that (installed-boot-zero-wait, #910 Nov 20 2026): past HASH_WAIT_MS
        // the bare path goes, which the service worker answers with the kept copy.
        if (typeof serviceWorkerManager !== 'undefined' && serviceWorkerManager
            && typeof serviceWorkerManager.hashForStaticPath === 'function') {
            let timer = 0;
            try {
                hash = await Promise.race([
                    serviceWorkerManager.hashForStaticPath(pathOnly),
                    new Promise((resolve) => { timer = setTimeout(() => resolve(null), FeatureLoader.HASH_WAIT_MS); })
                ]);
            } catch (_) {
                hash = null;
            } finally {
                clearTimeout(timer);
            }
        }
        if (!hash) return pathOnly;
        // buildShaBustUrl: public/scripts/comp/serviceWorkerManager.js
        // Same ?sha= the service worker's manifest hash uses. sw.js matches the
        // pathname (ignoreSearch), so this hits the precached row instead of a second fetch.
        return buildShaBustUrl(pathOnly, hash);
    }

    /**
     * The link of a stylesheet, or null when the page had it already. A stylesheet that left app.html for a feature
     * (#1001) keeps its place in the cascade: app.html has <meta name="melaton-feature-css" content="/css/...">
     * where its link was, and the link goes right after it (the sheets after it, the HiDPI bg.css among them, still
     * come later and win their ties as before). Others go at the end of <head>.
     */
    async _injectStylesheet(href) {
        const url = await this._versionedAssetUrl(href);
        const pathOnly = url.split('?')[0];
        const have = [...document.querySelectorAll('link[rel="stylesheet"][href]')].filter((l) => new URL(l.href, location.href).pathname === pathOnly);
        if (have.length) { this._refreshLinks(have, url); return null; }

        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        const place = [...document.querySelectorAll('meta[name="melaton-feature-css"]')].find((m) => m.getAttribute('content') === pathOnly);
        if (place) place.after(el);
        else document.head.appendChild(el);
        return el;
    }

    /**
     * New stylesheet links have loaded (or failed). Answered from the service worker's copy at once; a sheet the cache
     * does not have yet waits for the network, at most STYLE_WAIT_MS: the window then opens as it would have.
     */
    static stylesLoaded(links) {
        const wait = (link) => new Promise((resolve) => {
            if (!link || link.sheet) { resolve(); return; }
            const timer = setTimeout(resolve, FeatureLoader.STYLE_WAIT_MS);
            const done = () => { clearTimeout(timer); resolve(); };
            link.addEventListener('load', done, { once: true });
            link.addEventListener('error', done, { once: true });
        });
        return Promise.all((links || []).map(wait));
    }

    /**
     * A program's stylesheets at the version of the script it is about to load (#975). The page links its
     * stylesheets when it boots; an update downloaded later gives every script loaded on demand its new copy
     * (_versionedAssetUrl asks for the cache's hash) while the page keeps the stylesheets it booted with until
     * its restart, so a program loaded in between drew its new markup with its old styles (Melaton Media on
     * the A53: the playback screen collapsed into one corner). The shell's on-demand programs
     * (wmShell.js loadLazyApp) and every feature (styles) call this first: a stylesheet whose ?sha= is not
     * the cache's goes in again at the cache's version, right after the old link (its place in the
     * cascade), and the old link leaves once the new one has loaded. Matching versions change nothing.
     */
    ensureStyles(list) {
        return Promise.all((list || []).map((href) => this._injectStylesheet(href).catch(() => { /* offline: the page's own */ })));
    }

    _refreshLinks(links, url) {
        const want = new URL(url, location.href).searchParams.get('sha');
        if (!want) return;
        const shaOf = (l) => new URL(l.href, location.href).searchParams.get('sha');
        // a link without ?sha= (a page served without hashes) is left alone: no version to compare
        if (links.some((l) => shaOf(l) === want || !shaOf(l))) return;
        const old = links[links.length - 1];
        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = url;
        el.addEventListener('load', () => links.forEach((l) => l.remove()), { once: true });
        old.after(el);
    }

    _loadScript(src) {
        return this._versionedAssetUrl(src).then((url) => new Promise((resolve, reject) => {
            const pathOnly = url.split('?')[0];
            if (document.querySelector(`script[src^="${pathOnly}"]`)) {
                resolve();
                return;
            }

            const el = document.createElement('script');
            el.src = url;
            el.async = false;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.body.appendChild(el);
        }));
    }
}

window.featureLoader = new FeatureLoader();

/*
 * Clicks made while the page could not run are dropped, not replayed (#910, Nov 20 2026). On the Mac the page stood
 * still for up to 25 s at a time (the shell bridge's synchronous reads waited on a CaféReady stuck behind a dead Wi-Fi
 * firmware); every click made meanwhile was kept by the browser and ran the moment it could, so the programs clicked
 * in vain all opened at once. A press the page sees more than STALE_INPUT_MS after it was made is one of those: it,
 * and the release and click that follow it, go nowhere. A fresh press ends that. Discrete events only (presses,
 * releases, clicks), capture on window, passive where they may be (no scroll waits on them).
 */
(function dropStaleInput() {
    const STALE_INPUT_MS = 1500;
    let swallowing = false;
    const stale = (e) => e.isTrusted && e.timeStamp > 0 && performance.now() - e.timeStamp > STALE_INPUT_MS;
    const drop = (e) => {
        e.stopImmediatePropagation();
        if (e.cancelable && !e.defaultPrevented && /click|contextmenu/.test(e.type)) e.preventDefault();
    };
    let told = 0;
    const tell = (e) => {
        if (Date.now() - told < 5000) return;
        told = Date.now();
        console.warn(`[input] a ${e.type} ${Math.round(performance.now() - e.timeStamp)} ms old was dropped: the page could not run when it was made`);
    };
    const on = (type, fn, passive) => {
        // app-scope: allow page lifetime (every program's input passes here; the loader lives as long as the page)
        window.addEventListener(type, fn, { capture: true, passive });
    };
    ['pointerdown', 'mousedown', 'touchstart'].forEach((type) => on(type, (e) => {
        swallowing = stale(e);
        if (swallowing) { tell(e); drop(e); }
    }, true));
    ['pointerup', 'mouseup', 'touchend'].forEach((type) => on(type, (e) => { if (swallowing || stale(e)) drop(e); }, true));
    ['click', 'dblclick', 'auxclick', 'contextmenu'].forEach((type) => on(type, (e) => { if (swallowing || stale(e)) drop(e); }, false));
})();

/** Cartograph entry — loads explorerApplet.js then opens. */
async function openExplorerApplet(path) {
    await featureLoader.loadFeature('explorer');
    // wireStudioVfsDrop / initializeExplorerApplet: public/scripts/comp/explorerApplet.js
    wireStudioVfsDrop();
    const app = initializeExplorerApplet();
    if (app) app.open(path);
}

/** The Notepad manager, loading notepadManager.js first if nothing has opened Notepad yet. */
async function loadNotepadManager() {
    await featureLoader.loadFeature('notepad');
    return window.notepadManager || null;
}

async function openGrimoireApplet(initialQuery) {
    await featureLoader.loadFeature('grimoire');
    // a search from elsewhere is a new tab (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    const query = String(initialQuery || '').trim();
    if (query && grimoireOpenInTab({ address: 'edtx://en.grimoire.jp/search?q=' + encodeURIComponent(query) })) return;
    tagWikiSearchModal.open(initialQuery || '');
}

// Alchemy Home until the local homepage lands (Yozora #318)
const ALCHEMY_HOME_URL = 'https://www.bing.com/';

// http(s) lands in Alchemy, Grimoire's remote browser (TagWikiSearchModal.navigate)
async function openGrimoireUrl(url) {
    await featureLoader.loadFeature('grimoire');
    // a new tab in the Grimoire window (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    if (grimoireOpenInTab({ address: url })) return;
    tagWikiSearchModal.open('', { skipInitialHome: true });
    tagWikiSearchModal.navigate(url);
}

// A web link from anywhere in the app opens as an Alchemy tab instead of a browser tab.
// Same-origin and non-web URLs, and a Grimoire that will not load, keep the browser's new tab.
// Sign-in flows that need the user's own browser cookies (NovelAI Explore, Cursor login) call open() directly.
function openWebUrl(url) {
    let parsed = null;
    try { parsed = new URL(url, location.href); } catch (_) { /* not a URL */ }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin === location.origin) {
        open(url, '_blank', 'noopener,noreferrer');
        return Promise.resolve();
    }
    return openGrimoireUrl(parsed.href).catch(() => {
        open(parsed.href, '_blank', 'noopener,noreferrer');
    });
}

// Every web <a> in the app (Grimoire articles, references, applets) goes through openWebUrl on a
// left or middle click. Handlers that own their links (Grimoire search links, the DSAP leave dialog,
// Director chat) preventDefault first. Ctrl/Shift/Alt/Meta-click and data-browser-tab keep the browser.
function catchWebLinkClick(e) {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (e.button !== 0 && e.button !== 1) return;
    const link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.hasAttribute('data-browser-tab')) return;
    let url;
    try { url = new URL(link.href); } catch (_) { return; }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === location.origin) return;
    e.preventDefault();
    void openWebUrl(url.href);
}
document.addEventListener('click', catchWebLinkClick);
document.addEventListener('auxclick', catchWebLinkClick);

// Clients with no browser tabs, the DreamOS kiosk's new-tab hand-over and the page's own full screen (#910);
// exported: clientHasNoBrowserTabs, openUrlInNewWindow, melatonFullscreen
(() => {
    // A client with no browser tabs (the DreamOS kiosk, the Dreamscape app, an installed window): a page "new tab" or
    // "new window" can only be Grimoire there (#910; Yukimi, Nov 20 2026). DreamOS: its kiosk adds " DreamOS/<version>"
    // to the user agent (#923); the Dreamscape app has its Android bridges.
    function clientHasNoBrowserTabs() {
        if (/ DreamOS\//.test(navigator.userAgent || '')) return true;
        if (window.AndroidDevice || window.AndroidCaption || window.AndroidNotification) return true;
        try { return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches; } catch (_) { return false; }
    }

    // Opens a page that must have a real browser (a sign-in that needs the user's own cookies, a download): a browser
    // tab where there are tabs, Grimoire where there are none.
    function openUrlInNewWindow(url) {
        if (clientHasNoBrowserTabs()) return openGrimoireUrl(url).catch(() => {});
        open(url, '_blank', 'noopener,noreferrer');
        return Promise.resolve();
    }

    // The DreamOS kiosk keeps one tab: a tab the browser opened anyway (a target=_blank link or window.open the page left
    // to it) is closed at once and its address handed here by the shell extension (DreamOS shell-ext background.js +
    // relay.js, window message dreamosOpenUrl). It opens as a new Grimoire tab - never window.open again (the kiosk would
    // hand it straight back).
    // app-scope: allow shell: the kiosk's hand-over lives as long as the page
    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data || typeof e.data.dreamosOpenUrl !== 'string') return;
        let url;
        try { url = new URL(e.data.dreamosOpenUrl); } catch (_) { return; }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
        openGrimoireUrl(url.href).catch(() => {});
    });

    /**
     * Full screen for the page's own players (Media Player, Videos): melatonFullscreen.request(el) / exit() / element(),
     * and the event melatonfullscreenchange on document.
     *
     * Where the page already fills the screen (the DreamOS kiosk, the Dreamscape app, an installed window, a browser in
     * F11) it is the page's own full screen (#910; Yukimi, Nov 20 2026): the element goes into the top layer as a manual
     * popover and covers the whole screen, taskbar and windows included - no browser full screen, so never Chromium's
     * "Press Esc to exit full screen" notice. Esc and F11 leave it (the app's own control too). In a browser tab it is
     * the browser's full screen (the tab's toolbars go), and the page's own when the browser refuses it.
     */
    const melatonFullscreen = (() => {
        const FAKE_STYLE = {
            position: 'fixed', inset: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none',
            margin: '0', border: '0', padding: '0', overflow: 'hidden', background: '#000', 'z-index': '2147483647'
        };
        let fake = null; // { el, style, popover }
        const tell = () => document.dispatchEvent(new Event('melatonfullscreenchange'));
        const pageFillsScreen = () => clientHasNoBrowserTabs()
            || (window.innerWidth >= screen.width && window.innerHeight >= screen.height);
        const onKey = (e) => {
            if (!fake || (e.key !== 'Escape' && e.key !== 'F11')) return;
            e.preventDefault();
            e.stopPropagation();
            exitFake();
        };
        function enterFake(el) {
            if (fake && fake.el === el) return;
            if (fake) exitFake(true);
            fake = { el, style: el.getAttribute('style'), popover: el.getAttribute('popover') };
            for (const [k, v] of Object.entries(FAKE_STYLE)) el.style.setProperty(k, v, 'important');
            // the top layer: above every window and the taskbar, whatever transform or stacking its ancestors have
            if (typeof el.showPopover === 'function') {
                try { el.setAttribute('popover', 'manual'); el.showPopover(); } catch (_) { /* not in the document */ }
            }
            // capture: before the app's own key handlers (the window's Esc closes dialogs)
            // app-scope: allow removed in exitFake, same file
            window.addEventListener('keydown', onKey, true);
            tell();
        }
        function exitFake(quiet) {
            if (!fake) return;
            const { el, style, popover } = fake;
            fake = null;
            window.removeEventListener('keydown', onKey, true);
            try { if (el.matches(':popover-open')) el.hidePopover(); } catch (_) { /* gone */ }
            if (popover === null) el.removeAttribute('popover'); else el.setAttribute('popover', popover);
            if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
            if (!quiet) tell();
        }
        function request(el) {
            if (!el) return Promise.resolve();
            if (pageFillsScreen() || typeof el.requestFullscreen !== 'function') { enterFake(el); return Promise.resolve(); }
            if (fake) exitFake(true);
            return el.requestFullscreen().catch(() => enterFake(el));
        }
        function exit() {
            if (fake) { exitFake(); return Promise.resolve(); }
            return document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
        }
        const element = () => (fake && fake.el) || document.fullscreenElement || null;
        // the browser's own full screen (a tab) reports through the same event
        // app-scope: allow shell: page-lifetime helper
        document.addEventListener('fullscreenchange', tell);
        return { request, exit, element };
    })();
    window.clientHasNoBrowserTabs = clientHasNoBrowserTabs;
    window.openUrlInNewWindow = openUrlInNewWindow;
    window.melatonFullscreen = melatonFullscreen;
})();

// New standalone Alchemy window (wikiWindowManager), not the main Grimoire tab.
// grimoireOpenStandaloneWindow: public/scripts/comp/grimoireRemoteBrowser.js
async function openGrimoireStandaloneUrl(url, windowTitle) {
    await featureLoader.loadFeature('grimoire');
    // a tab in the Grimoire window when it has the tab strip (grimoireOpenInTab: public/scripts/comp/grimoireTabs.js)
    if (grimoireOpenInTab({ url })) return;
    grimoireOpenStandaloneWindow(url, null, windowTitle);
}

// Start a Vista game by id (minesweeper, solitaire ...): its feature, then the game's open()
// from the VistaGames registry (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js)
async function openVistaGame(id) {
    await featureLoader.loadFeature('vista_' + id);
    const game = window.VistaGames && VistaGames.list().find((entry) => entry.id === id);
    if (!game) throw new Error('Game not found: ' + id);
    return game.open();
}

async function openSpellbookApplet() {
    await featureLoader.loadFeature('spellbook');
    // initializeSpellbookModalManager: public/scripts/comp/spellbookModal.js
    const manager = initializeSpellbookModalManager();
    if (manager) manager.openModal();
    return manager;
}

async function openNaxtApplet() {
    await featureLoader.loadFeature('naxt');
    // initializeNaxtBagTray: public/scripts/comp/naxtApplet.js
    initializeNaxtBagTray();
    return naxtApplet.open();
}

async function openBracketGenerationApplet(options) {
    await featureLoader.loadFeature('bracket_gen');
    // initializePhasewalkerTray: public/scripts/comp/bracketGenerationApplet.js
    initializePhasewalkerTray();
    return bracketGenerationApplet.open(options);
}

function phasewalkerSubmenuItems(build) {
    // buildPhasewalkerContextSubmenuItems: public/scripts/comp/runCommandIndex.js
    if (typeof buildPhasewalkerContextSubmenuItems === 'function') return build();
    void featureLoader.loadFeature('run_index').then(() => {
        // refreshSubmenu: public/scripts/comp/contextMenu.js
        if (typeof contextMenu !== 'undefined' && contextMenu && typeof contextMenu.refreshSubmenu === 'function') {
            contextMenu.refreshSubmenu();
        }
    });
    return [{ text: 'Loading...', disabled: true }];
}

async function ensureRunCommandIndex() {
    await featureLoader.loadFeature('run_index');
}

// Weather styles are not on the first paint. Idle, after first paint.
const WEATHER_IDLE_STYLES = [
    'css/weather-location.css',
    'css/weather-cards.css',
    'css/weather-lcd.css',
    'dist/fonts/weather-icons.min.css'
];

function registerAssetPreloadStepStub() {
    if (typeof isDesktop === 'undefined' || !isDesktop) return;
    if (typeof wsClient === 'undefined' || !wsClient || wsClient._assetPreloadStepsStubbed) return;
    wsClient._assetPreloadStepsStubbed = true;
    wsClient.registerInitStep(12.2, 'Loading wallpaper', function () {
        return assetPreload.preloadWallpaperStage();
    });
    wsClient.registerInitStep(18.2, 'Loading desktop icons', function () {
        return assetPreload.preloadDesktopIconsStage();
    });
    wsClient.registerInitStep(18.4, 'Loading desktop assets', function () {
        return assetPreload.preloadDesktopAssetsStage();
    });
    // The Sidebar is drawn hidden here too, or it popped in after the Welcome screen had gone (Nov 20 2026): with this
    // stub registered first, assetPreload.js returned before its own 18.6 / 18.8 (vistaSidebar.js vistaSidebarBoot)
    wsClient.registerInitStep(18.6, 'Loading gadgets', function () {
        if (window.assetPreload) return assetPreload.preloadGadgetsStage();
        return window.vistaSidebarBoot ? window.vistaSidebarBoot.start() : null;
    });
    wsClient.registerInitStep(18.8, 'Loading splash screens', function () {
        return window.assetPreload ? assetPreload.preloadSplashStage() : null;
    });
}

registerAssetPreloadStepStub();

// scheduleAfterFirstPaint: public/scripts/comp/serviceWorkerManager.js
if (typeof scheduleAfterFirstPaint === 'function') {
    scheduleAfterFirstPaint(() => {
        // loadAssetPreloadScript: public/app.html (head stand-in)
        loadAssetPreloadScript().catch((err) => {
            console.warn('Asset preload idle load failed:', err);
        });
        WEATHER_IDLE_STYLES.forEach((href) => {
            void featureLoader._injectStylesheet(href);
        });
    });
}
