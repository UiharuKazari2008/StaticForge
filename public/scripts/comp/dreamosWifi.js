/*
 * DreamOS Wi-Fi windows (#910): Vista's wireless UI for the laptop's own adapter, which the CaféReady host drives
 * (window.DreamOSNetwork in the shell bridge, cafeready wifi.rs on iwd). Built 1:1 from the Vista VM's own
 * resources (dialog templates and strings of VAN.dll, WLanConn.dll, wlandlg.dll, wlanpref.dll, wlanui.dll and
 * netshell.dll; their art in static_images/vista-net), "Windows" reading Melaton:
 *
 *   Connect to a network         VAN.dll 7111 in the Aero wizard: Show All / Dial-up and VPN / Wireless, the list
 *                                (name, "Connected" / "Security-enabled network" / "Unsecured network", the bars),
 *                                then wlandlg 301 (the security key), WLanConn 101 (unsecured network), 102
 *                                (connecting), 103 (connected: Save this network / Start this connection
 *                                automatically) and 107 (cannot connect). The Nightshade Network sits under
 *                                Dial-up and VPN and hands over to its own client (nightshadeClient.js)
 *   Manage Wireless Networks     wlanpref.dll's folder as a Control Panel folder page: the saved networks, Add,
 *                                Remove (forget), Move up / Move down, Adapter properties, Profile types, a
 *                                network's Properties (wlanui 17052 / 17053)
 *   Wireless Network Connection  netshell 24050 (General): IPv4 / IPv6 connectivity, media state, SSID, duration,
 *   Status                       speed, signal quality, activity; Details... (netshell 24300), Wireless
 *                                Properties, Properties (netshell 16004), Disable (the radio), Diagnose
 *
 *   window.dreamosWifi = { openConnect(), openManage(), openStatus(), available(), signalLevel(percent) }
 *
 * Nothing polls: the host pushes 'dreamosnet' (state) and 'dreamosnetscan' (a scan's list); opening Connect to a
 * network and its Refresh button ask for a scan. The status sheet's Duration counts on a local clock while it
 * shows. Without window.DreamOSNetwork (a browser, the phone) there is no wireless adapter: Connect to a network
 * lists only the Dial-up and VPN connection, as Vista does on a computer without one, and the other two windows
 * say that no wireless network interface was found.
 *
 * The host keeps no priority order for saved networks (iwd ranks them itself), so Move up / Move down keep the
 * order in this browser (localStorage), together with the saved networks seen out of range.
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const host = () => root.DreamOSNetwork || null;
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fill = (text, v) => String(text).replace(/%1(!s!)?/g, v);

    const NET = '/static_images/vista-net';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';
    const REFRESH = '/static_images/vista-cmdbar/refresh.png';
    const ADAPTER = 'Wireless Network Connection'; // netshell 1813

    // Vista's strings (.mui string tables), Windows -> Melaton
    const S = {
        selectNetwork: 'Select a network to connect to', // VAN 700
        disconnectOr: 'Disconnect or connect to another network', // 701
        connectedTo: 'This computer is connected to a network', // 703
        connectedName: 'This computer is connected to %1', // 704
        noNetworks: 'Melaton cannot find any networks.', // 710
        noMore: 'Melaton cannot find any additional networks.', // 711
        diagNone: 'Diagnose why Melaton can’t find any networks', // 717
        diagMore: 'Diagnose why Melaton cannot find any additional networks', // 718
        connect: 'Connect', disconnect: 'Disconnect', // 705 / 706 (wizard button, no access key drawn)
        all: 'All', // 730
        dialup: 'Dial-up and VPN', // rasmm 300
        wireless: 'Wireless', // wlanmm 300
        secured: 'Security-enabled network', // wlanmm 203
        unsecured: 'Unsecured network', // wlanmm 204
        connected: 'Connected', // wlanmm 208
        vpn: 'VPN connection', // rasmm 203
        tipName: 'Name: %1', tipSignal: 'Signal Strength: %1', // VAN 721 / 720
        strength: ['No Signal', 'Low', 'Poor', 'Fair', 'Good', 'Excellent'], // VAN 723-728
        connecting: 'Connecting to %1', // WLanConn 1001
        disconnecting: 'Disconnecting from %1', // 1002
        isUnsecured: '%1 is an unsecured network', // 1003
        cannot: 'Melaton cannot connect to %1', // 1006
        success: 'Successfully connected to %1', // 1009
        close: 'Close', // 1000
        typeKey: 'Type the network security key or passphrase for %1', // wlandlg 260
        keyInvalid: 'The network security key is not valid.', // wlandlg 240
        keyShort: 'The network key you entered is not valid. \nType the key again, using at least 8 characters.', // 243
        keyLong: 'The network key you entered is not valid. \nType the key again, using a maximum length of 63 characters; or 64 characters using digits 0-9 and letters A-F.', // 244
        keyAscii: 'Melaton could not map all of the characters into ASCII. Security keys must be entered as ASCII characters.', // 245
        noInterfaces: 'Melaton cannot detect any wireless network interfaces', // wlanpref 10930
        manage: 'Manage Wireless Networks', // 20001
        manageThat: 'Manage wireless networks that use (%1)', // 20003
        manageText: 'Melaton tries to connect to these networks in the order listed below. To change the order, drag a network up or down in the list. You can also add or remove network profiles.', // 20006
        wirelessOff: 'Wireless is not currently enabled.', // 20007
        canModify: 'Networks you can view and modify', // 20016
        anySupported: 'Any supported', automatic: 'Automatically connect', manual: 'Manually connect', // 19004 / 19002 / 19003
        unsecuredType: 'Unsecured', // 19001
        addTitle: 'Manually connect to a wireless network', // 10902
        addHow: 'How do you want to add a network?', // 10912
        statusTitle: 'Wireless Network Connection Status', // netshell 23041
        propsTitle: 'Wireless Network Connection Properties', // netshell 1057
        netProps: '%1 Wireless Network properties', // wlanui 17302
        accessPoint: 'Access point', allUsers: 'All users', // wlanui 17109 / 17404
        notAvailable: 'Not Available', notConnected: 'Not Connected', // netshell 23137 / 23176
        internet: 'Internet', local: 'Local', limited: 'Limited', // 23175 / 23174 / 23173
        enabled: 'Enabled', disconnected: 'Disconnected', // 1050 / 1040
        day: ' day ', days: ' days ' // 23069 / 23070
    };

    // Security types as Vista names them: Manage Wireless Networks (wlanpref 19001-19011) and a network's
    // Security page (wlanui 17101-17105, 17200-17205). iwd says only psk / open / 8021x / wep.
    const SEC_MANAGE = { open: S.unsecuredType, psk: 'WPA2-Personal', '8021x': 'WPA2-Enterprise', wep: 'WEP' };
    const SEC_TYPE = { open: 'No authentication (Open)', psk: 'WPA2-Personal', '8021x': 'WPA2-Enterprise', wep: 'Shared' };
    const SEC_CIPHER = { open: 'None', psk: 'AES', '8021x': 'AES', wep: 'WEP' };

    // The templates (DLGTEMPLATEEX from the VM's .mui files, the format of vistaDialogTemplates.js), added to the
    // shared table when a window opens
    const TPL = {
        "van:7111": {"t":"Connect to a network","w":317,"h":143,"f":["Segoe UI",9],"s":1220542536,"c":[[1005,"S",0,2,35,8,1342308354,"Show",0],[1004,"C",40,0,110,12,1344339971,"",0],[1014,"B",296,0,20,12,1342242944,"Refresh",0],[1015,"S",296,0,20,12,1342177806,"",32],[1016,"B",0,12,317,104,1342177287,"",0],[1009,"L",0,14,317,104,1352729825,"",0],[1012,"S",4,45,309,16,1342308352,"Melaton cannot find any networks",0],[1013,"SysLink",4,64,309,8,1342242816,"<A>View network computers and devices</A>",0],[1008,"SysLink",0,118,317,8,1342242816,"<A>Diagnose connection problems</A>",0],[1006,"SysLink",0,126,317,8,1342242816,"<A>Set up a connection or network</A>",0],[1007,"SysLink",0,134,317,8,1342242816,"<A>Open Network and Sharing Center</A>",0]]},
        "wlandlg:301": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[405,"SysLink",0,0,500,20,1342242818,"The person who setup the network can give you the key or passphrase.",0],[-1,"S",0,28,111,8,1342308352,"&Security key or passphrase:",0],[401,"E",0,42,178,14,1350631584,"",0],[402,"B",0,62,71,10,1342242819,"&Display characters",0],[408,"S",0,120,20,20,1342177283,"",0],[407,"SysLink",26,122,250,20,1342251014,"",0],[409,"SysLink",26,122,250,20,1073815554,"",0],[410,"SysLink",26,122,250,20,1073815554,"",0]]},
        "wlanconn:101": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[323,"B",31,5,250,35,1342242830,"&Connect Anyway\n Information sent over this network might be visible to others.",0],[332,"B",31,54,250,27,1342242830,"C&onnect to a different network",0]]},
        "wlanconn:102": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[302,"msctls_progress32",74,66,152,8,1350565896,"",0],[356,"S",44,54,212,9,1342308353,"Connecting to the network is taking longer than usual",0],[307,"S",7,4,303,21,1342308352,"",0],[3325,"S",61,10,48,48,1342179331,"",0],[3329,"S",88,10,118,48,1342179331,"",0],[3330,"S",210,10,48,48,1342179331,"",0],[3331,"S",210,10,48,48,1342179331,"",0]]},
        "wlanconn:103": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542536,"c":[[340,"B",10,45,227,30,1342242830,"&Connect to another network",0],[336,"B",0,10,227,10,1342242819,"&Save this network",0],[3327,"S",0,26,16,16,1342179331,"",0],[3336,"B",12,25,250,10,1342373897,"S&ave this network for all users of this computer",0],[3337,"B",12,38,250,10,1342242825,"Sa&ve this network for me only",0],[3338,"B",12,51,250,10,1342242825,"&Don't save this network",0],[3339,"B",12,66,206,10,1342242819,"S&tart this connection automatically",0]]},
        "wlanconn:107": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[339,"B",31,5,250,27,1342242830,"&Diagnose the problem",0],[340,"B",31,42,250,27,1342242830,"&Connect to a different network",0]]},
        "netshell:24050": {"t":"General","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[-1,"S",7,9,37,8,1342308352,"Connection",0],[23501,"S",17,21,100,8,1342308352,"IPv4 Connectivity:",0],[23502,"S",110,21,100,8,1342308352,"None",4096],[23503,"S",17,32,100,8,1342308352,"IPv6 Connectivity:",0],[23504,"S",110,32,100,8,1342308352,"None",4096],[1032,"S",17,43,100,8,1342308352,"Media State:",0],[1007,"S",73,43,137,8,1342308352,"Disconnected",4096],[24016,"S",17,54,100,8,1342308352,"SSID:",0],[24018,"S",73,54,137,8,1342308352,"",4096],[1033,"S",17,65,100,8,1342308352,"Duration:",0],[1008,"S",73,65,137,8,1342308352,"00:00:00",4096],[1034,"S",17,76,100,8,1342308352,"Speed:",0],[1009,"S",73,76,137,8,1342308352,"0 bps",4096],[1043,"S",17,91,100,8,1342308352,"Signal Quality:",0],[1044,"S",190,84,20,1,1342177294,"",0],[23506,"B",17,106,50,14,1342242816,"D&etails...",0],[24020,"B",70,106,90,14,1342242816,"&Wireless Properties",0],[1035,"S",54,145,41,8,1342308352,"Sent",4096],[1030,"S",99,149,13,1,1342177288,"",0],[1010,"S",121,138,20,20,1342177283,"",0],[1031,"S",156,149,13,1,1342177288,"",0],[1036,"S",174,145,35,8,1342308352,"Received",4096],[1023,"S",17,165,34,8,1342308352,"Bytes:",0],[1003,"S",52,165,63,8,1342308352,"0",4096],[1028,"S",134,165,1,21,1342177288,"",0],[1029,"S",134,165,1,10,1342177288,"",0],[1005,"S",149,165,61,8,1342308352,"0",4096],[1027,"S",17,177,32,8,1342308352,"Errors:",0],[1012,"S",69,177,46,8,1342308352,"0",4096],[1013,"S",164,177,46,8,1342308352,"0",4096],[-1,"S",7,127,25,8,1342308352,"Activity",0],[-1,"S",35,130,184,1,1342177296,"",0],[-1,"S",48,13,172,1,1342177296,"",0],[1026,"B",7,192,55,14,1342242816,"&Properties",0],[1025,"B",65,192,55,14,1342242816,"&Disable",0],[23505,"B",123,192,55,14,1342242816,"Dia&gnose",0]]},
        "netshell:24300": {"t":"Network Connection Details","w":240,"h":250,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[65535,"S",7,7,95,8,1342308352,"Network Connection &Details:",0],[24301,"SysListView32",7,17,226,198,1352728577,"List1",512],[65535,"S",7,221,226,1,1342181392,"",0],[1,"B",184,227,50,14,1342242817,"&Close",0]]},
        "netshell:16004": {"t":"Networking","w":227,"h":226,"f":["MS Shell Dlg",8],"s":1220542528,"c":[[65535,"S",7,7,48,8,1342308352,"Connect using:",0],[15021,"E",7,18,213,18,1484785792,"",0],[15003,"E",28,21,182,12,1342179456,"",0],[16006,"S",12,20,16,16,1073741827,"",0],[15031,"B",160,39,60,14,1342242816,"&Configure...",0],[16055,"S",7,54,213,8,1342308352,"This c&onnection uses the following items:",0],[15007,"SysListView32",7,66,213,86,1350680589,"",0],[15008,"B",7,156,67,14,1342242816,"I&nstall...",0],[15012,"B",80,156,67,14,1342242816,"&Uninstall",0],[15011,"B",153,156,67,14,1342242816,"P&roperties",0],[16056,"B",7,173,213,42,1342177287,"Description",0],[15020,"S",16,184,196,28,1342308352,"",0]]},
        "wlanui:17052": {"t":"Connection","w":235,"h":213,"f":["MS Shell Dlg",8],"s":1086849224,"c":[[15080,"S",9,14,48,8,1342308352,"Name:",0],[15081,"S",82,14,140,8,1342324864,"Profile name",0],[1101,"S",9,27,48,8,1342308352,"SSID:",0],[15071,"S",9,40,48,8,1342308352,"Network Type:",0],[1100,"S",82,27,140,8,1342324864,"some ssid network",0],[15073,"S",82,40,140,8,1342324736,"??? network",0],[1127,"S",9,53,70,8,1342308352,"Network Availability:",0],[1128,"S",82,53,140,8,1342324736,"some rights",0],[1104,"B",10,77,206,10,1342252035,"Connect auto&matically when this network is in range",0],[1105,"B",10,90,206,12,1342252035,"Connect to a more &preferred network if available",0],[1106,"B",10,103,206,10,1342252035,"C&onnect even if the network is not broadcasting",0],[15075,"B",10,116,206,10,1342242819,"&Enable %s connection settings",0],[1107,"B",21,129,50,15,1342242816,"&Configure...",0]]},
        "wlanui:17053": {"t":"Security","w":235,"h":245,"f":["MS Shell Dlg",8],"s":1220542536,"c":[[1110,"S",9,21,67,10,1342308352,"S&ecurity type:",0],[1111,"C",81,19,123,80,1344339971,"",0],[1113,"S",9,38,63,10,1342308352,"E&ncryption type:",0],[1112,"C",81,36,123,53,1344339971,"",0],[1114,"S",9,55,68,8,1073872896,"Network security &key",0],[1115,"E",81,53,123,14,1082196128,"",0],[1116,"E",81,53,123,14,1082196096,"",0],[1117,"B",81,73,77,10,1073807363,"S&how characters",0],[1126,"S",9,93,67,10,1073872896,"Key &Index:",0],[1125,"C",81,91,20,80,1344339971,"",0],[1124,"B",155,53,50,15,1342242816,"&Configure...",0],[1118,"S",9,85,200,8,1342308352,"Ch&oose a network authentication method:",0],[1119,"C",9,95,143,70,1344339971,"",0],[1120,"B",155,94,50,15,1342242816,"&Settings...",0],[1121,"B",10,112,178,16,1342251011,"C&ache user information for subsequent connections to this network",0]]},
        "wlanpref:20060": {"t":"Manage Wireless Networks - Warning!","w":260,"h":79,"f":["Segoe UI",9],"s":2160591048,"c":[[-1,"S",5,5,25,25,1342177283,"",0],[20062,"S",30,5,250,50,1342308352,"If you remove this network from the list you will\nno longer be able to connect to it automatically.\n\nDo you wish to proceed?",0],[1,"B",150,60,50,14,1342242816,"OK",0],[2,"B",205,60,50,14,1342242816,"Cancel",0]]},
        "wlanpref:10102": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":2160591048,"c":[[10338,"B",4,0,280,42,1342242830,"&Add a network that is in range of this computer\nThis shows you a list of networks that are currently available and lets you connect to one. Once you connect, a profile for the network is saved on your computer.",0],[10309,"B",4,47,280,52,1342242830,"&Manually create a network profile\nThis creates a new network profile or locates an existing network and saves a profile for the network on your computer. You need to know the network name (SSID) and security key (if applicable).",0],[10310,"B",4,104,280,35,1342242830,"&Create an ad hoc network\nThis creates a temporary network for sharing files or an Internet connection",0]]},
        "wlanpref:20068": {"t":"Wireless Network Profile Type","w":350,"h":149,"f":["Segoe UI",9],"s":2160591048,"c":[[-1,"S",10,10,20,20,1342177283,"",0],[20069,"S",40,10,300,20,1342308352,"Choose the type of profile to assign to new wireless networks",0],[20070,"S",40,35,300,25,1342308352,"By default, connections to wireless networks from your computer can be accessed by anyone with a user account on the computer (all-user). If you change this setting, users can create connections that can only be accessed and modified by them (per-user).",0],[20075,"B",40,65,200,10,1342308361,"Use all-user profiles only (recommended)",0],[20076,"B",40,79,200,10,1342177289,"Use all-user and per-user profiles",0],[-1,"S",50,92,16,16,1342177283,"",0],[20071,"S",74,92,265,30,1342308352,"Using per-user profiles can cause a loss of network connectivity when logging off or switching between users",0],[1,"B",232,127,50,14,1342242817,"Save",0],[2,"B",292,127,50,14,1342242816,"Cancel",0]]}
    };

    // ---- art (each Vista's own image at its own size, static_images/vista-net) ---------------------------------

    /** 0-5 bars from the host's percent, as the tray icon draws it (dreamosNetTray.js). */
    function signalLevel(percent) {
        const p = Number(percent);
        if (!Number.isFinite(p) || p <= 0) return 0;
        if (p >= 80) return 5;
        if (p >= 60) return 4;
        if (p >= 40) return 3;
        if (p >= 20) return 2;
        return 1;
    }

    // a 1x image with its 2x frame where Vista's icon has one
    const img = (name, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${NET}/${name}.png" srcset="${NET}/${name}@2x.png 2x" alt="" draggable="false">`;
    const img1 = (name, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${NET}/${name}.png" alt="" draggable="false">`;

    // ---- state ---------------------------------------------------------------------------------------------------

    function state() {
        const h = host();
        let s = null;
        try { s = h && h.get(); } catch (_) { s = null; }
        return s && typeof s === 'object' ? s : {};
    }

    function available() {
        const w = state().wifi;
        return !!(host() && w && w.present);
    }

    /** The connected Wi-Fi network, or null. */
    function current() {
        const w = state().wifi || {};
        return w.present && w.state === 'connected' && w.network && w.network.name ? w.network : null;
    }

    let scanned = []; // the host's last list (strongest first)
    let connectedSince = 0; // when this page saw the connection come up (Duration)
    let connectedName = '';

    function noteConnection() {
        const n = current();
        const name = n ? String(n.name) : '';
        if (name !== connectedName) {
            connectedName = name;
            connectedSince = name ? Date.now() : 0;
        }
        if (n && n.known) remember(name, n.security, n.autoConnect);
    }

    function setList(list) {
        if (!Array.isArray(list)) return;
        scanned = list.filter((n) => n && n.name);
        scanned.forEach((n) => { if (n.known) remember(n.name, n.security, n.autoConnect); });
    }

    function readList() {
        const h = host();
        if (!h || typeof h.networks !== 'function') return Promise.resolve(scanned);
        return Promise.resolve(h.networks()).then((r) => { if (r && Array.isArray(r.networks)) setList(r.networks); return scanned; }).catch(() => scanned);
    }

    function scan() {
        const h = host();
        if (!h || typeof h.scan !== 'function') return;
        Promise.resolve(h.scan()).catch(() => { /* the list stays as it was */ });
    }

    // The saved networks in Vista's priority order: kept here, since the host has none (see the header)
    const SAVED_KEY = 'dreamos.wifi.saved';
    function saved() {
        try {
            const v = JSON.parse(root.localStorage.getItem(SAVED_KEY) || '[]');
            return Array.isArray(v) ? v.filter((x) => x && x.name) : [];
        } catch (_) { return []; }
    }
    function storeSaved(list) {
        try { root.localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (_) { /* private window: the order lasts for the page */ }
    }
    function remember(name, security, auto) {
        const list = saved();
        const i = list.findIndex((x) => x.name === name);
        const rec = { name, security: security || (i >= 0 ? list[i].security : 'psk'), auto: auto === undefined || auto === null ? (i >= 0 ? list[i].auto : true) : !!auto };
        if (i >= 0) {
            if (list[i].security === rec.security && list[i].auto === rec.auto) return;
            list[i] = rec;
        } else list.push(rec);
        storeSaved(list);
    }
    function unremember(name) {
        storeSaved(saved().filter((x) => x.name !== name));
    }

    function message(text, title, icon) {
        return Promise.resolve(call('showConfirmationDialog', esc(text).replace(/\n/g, '<br>'),
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null,
            { title: title || 'Connect to a network', icon: icon === 'error' ? 'fas fa-circle-xmark' : icon === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle', sound: true }));
    }

    // a window still on screen (closed from the taskbar it stays in the page, hidden, until the kit replaces it)
    const live = (m) => !!(m && m.isConnected && !m.classList.contains('hidden'));

    // ---- the shared kit (vistaDialogTemplate.js, loaded on demand) and this file's stylesheet ---------------------

    let cssDone = false;
    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            root.vistaDialogTemplates = root.vistaDialogTemplates || {};
            Object.assign(root.vistaDialogTemplates, TPL);
            if (!cssDone && doc) {
                cssDone = true;
                const link = doc.createElement('link');
                link.rel = 'stylesheet';
                link.href = '/css/dreamos-wifi.css';
                doc.head.appendChild(link);
            }
            return root.vistaDialogTemplate;
        });
    }

    // ---- Connect to a network (VAN.dll) ---------------------------------------------------------------------------

    let van = null; // { ctx, filter, sel, pending: { name, pass, wasKnown, auto } }

    function nightshade() {
        const c = root.wsClient;
        let s = null;
        try { s = c && typeof c.nightshadeState === 'function' ? c.nightshadeState() : null; } catch (_) { s = null; }
        const n = root.melatonNetworkDialogs;
        let name = 'Nightshade Network';
        try { if (n && typeof n.connectionInfo === 'function') name = n.connectionInfo().connectionName || name; } catch (_) { /* default */ }
        return { name, connected: !!(s && s.service === 'connected') };
    }

    /** The rows Vista lists: the wireless networks in range, then Dial-up and VPN. */
    function vanRows() {
        const now = current();
        const wifi = scanned.map((n) => ({
            kind: 'wifi',
            key: `w:${n.name}`,
            name: String(n.name),
            security: n.security || 'open',
            bars: signalLevel(n.signalPercent),
            connected: !!(now && now.name === n.name) || (!!n.connected && !state().wifi),
            known: !!n.known,
            auto: n.autoConnect !== false
        }));
        // the connected network first, as Vista lists it
        wifi.sort((a, b) => (b.connected ? 1 : 0) - (a.connected ? 1 : 0));
        const ns = nightshade();
        const vpn = [{ kind: 'vpn', key: 'v:nightshade', name: ns.name, connected: ns.connected }];
        // no adapter (no host, or none present) or its radio off: no wireless networks to list
        return { wifi: !available() || state().wifi.radio === false ? [] : wifi, vpn };
    }

    function vanRowHtml(r) {
        const middle = r.connected ? S.connected : r.kind === 'vpn' ? S.vpn : r.security === 'open' ? S.unsecured : S.secured;
        const left = r.kind === 'vpn' ? img('rasmm-vpn-32') : img('wlanmm-wireless-32');
        const mark = r.kind === 'wifi' && r.security === 'open' && !r.connected ? img('van-unsecured-16', 'dwf-van-mark') : '';
        const right = r.kind === 'vpn' ? img('rasmm-server-32') : img(`wlanmm-bars-${r.bars}-32`);
        const tip = r.kind === 'wifi' ? ` title="${esc(`${fill(S.tipName, r.name)}\n${fill(S.tipSignal, S.strength[r.bars])}`)}"` : '';
        return `<div class="vdt-lv-row dwf-van-row${van && van.sel === r.key ? ' is-selected' : ''}" data-key="${esc(r.key)}" role="option"${tip}>`
            + `<span class="dwf-van-icon">${left}</span><span class="dwf-van-name">${esc(r.name)}</span><span class="dwf-van-state">${esc(middle)}</span>`
            + `<span class="dwf-van-mark-cell">${mark}</span><span class="dwf-van-right">${right}</span></div>`;
    }

    function vanPaint() {
        if (!van || !van.ctx || !van.ctx.modal.isConnected) return;
        const ctx = van.ctx;
        const page = ctx.content.querySelector('[data-vdt-page="van:7111"]');
        const list = page && page.querySelector('.dwf-van-list');
        if (!list) return;
        const rows = vanRows();
        const f = van.filter;
        const groups = [];
        if (f !== 'vpn' && rows.wifi.length) groups.push([ADAPTER, rows.wifi]);
        if (f !== 'wireless') groups.push([S.dialup, rows.vpn]);
        const shown = groups.reduce((a, g) => a.concat(g[1]), []);
        if (!shown.some((r) => r.key === van.sel)) van.sel = null;
        list.innerHTML = groups.map(([title, rs]) => (groups.length > 1 ? `<div class="vdt-lv-group">${esc(title)}</div>` : '') + rs.map(vanRowHtml).join('')).join('');
        const any = shown.length > 0;
        const someConnected = shown.some((r) => r.connected);
        const wired = (state().ethernet || []).some((l) => l && l.carrier && Array.isArray(l.ip) && l.ip.length);
        ctx.show(1012, !any, 'van:7111');
        ctx.show(1013, !any, 'van:7111');
        // something is connected (shown or not): Vista's "additional" wording, and the instruction names it
        const elsewhere = rows.wifi.concat(rows.vpn).find((r) => r.connected) || null;
        const more = any || wired || !!elsewhere;
        ctx.text(1012, more ? S.noMore : S.noNetworks, 'van:7111');
        ctx.html(1008, `<button type="button" class="tbp-link vdt-link" data-link="diag">${esc(more ? S.diagMore : S.diagNone)}</button>`, 'van:7111');
        const instruction = page.querySelector('.vdt-wizard-instruction');
        const text = someConnected ? S.disconnectOr : !any && elsewhere ? fill(S.connectedName, elsewhere.name) : !any && wired ? S.connectedTo : S.selectNetwork;
        if (instruction && instruction.textContent !== text) instruction.textContent = text;
        vanButton();
    }

    function vanSelected() {
        if (!van || !van.sel) return null;
        const rows = vanRows();
        return rows.wifi.concat(rows.vpn).find((r) => r.key === van.sel) || null;
    }

    /** The wizard's first button: Connect, or Disconnect for the connected network; off with nothing selected. */
    function vanButton() {
        if (!van || van.page !== 'van:7111') return;
        const next = van.ctx.content.querySelector('.vdt-wizard-next');
        if (!next) return;
        const r = vanSelected();
        const label = r && r.connected ? S.disconnect : S.connect;
        if (next.textContent !== label) next.textContent = label;
        next.disabled = !r;
    }

    function pageInstruction(ctx, key, text) {
        const el = ctx.content.querySelector(`[data-vdt-page="${key}"] .vdt-wizard-instruction`);
        if (el) el.textContent = text;
    }

    function footer(ctx, { cancel = true, nextText = null, firstPage = false, noBack = false } = {}) {
        // the Back orb stays in the caption, drawn disabled where there is no way back (the list page, the
        // connecting and result pages), as the VM's Connect to a network does
        const back = ctx.modal.querySelector('.vdt-wizard-back');
        if (back) {
            back.disabled = firstPage || noBack;
            back.hidden = false;
        }
        const c = ctx.content.querySelector('.vdt-wizard-cancel');
        if (c) c.hidden = !cancel;
        const n = ctx.content.querySelector('.vdt-wizard-next');
        if (n && nextText) n.textContent = nextText;
        if (n) n.disabled = false;
    }

    /** Connect (or Disconnect) the selected row: the next page's key, or false to stay. */
    function vanNext(ctx) {
        const r = vanSelected();
        if (!r) return false;
        if (r.kind === 'vpn') {
            // the Nightshade Network has its own client: it connects (and, behind its warning, disconnects) there
            ctx.close();
            if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open();
            return false;
        }
        van.pending = { name: r.name, pass: null, wasKnown: r.known, auto: r.auto, security: r.security };
        if (r.connected) {
            van.pending.disconnect = true;
            root.setTimeout(() => runDisconnect(ctx), 0);
            return 'wlanconn:102';
        }
        if (!r.known && r.security === 'open') return 'wlanconn:101';
        if (!r.known && r.security === 'psk') return 'wlandlg:301';
        if (!r.known) {
            // 802.1X and WEP networks need a profile the host cannot make from here
            van.pending.failed = true;
            return 'wlanconn:107';
        }
        root.setTimeout(() => runConnect(ctx), 0);
        return 'wlanconn:102';
    }

    let slowTimer = null;
    function connectingPage(ctx, text) {
        pageInstruction(ctx, 'wlanconn:102', text);
        ctx.show(356, false, 'wlanconn:102');
        if (slowTimer) root.clearTimeout(slowTimer);
        // "Connecting to the network is taking longer than usual" once it has been a while
        slowTimer = root.setTimeout(() => { slowTimer = null; if (van && van.page === 'wlanconn:102') ctx.show(356, true, 'wlanconn:102'); }, 15000);
    }

    async function runConnect(ctx) {
        const p = van && van.pending;
        const h = host();
        if (!p || !h) return;
        let r = null;
        try { r = await h.connect(p.name, p.pass || undefined); } catch (err) { r = { error: String((err && err.message) || err) }; }
        if (!van || van.ctx !== ctx || !ctx.modal.isConnected) return;
        if (r && r.error) {
            // a passphrase the host refused before trying: back to the key page, as Vista re-asks
            if (p.pass && /passphrase/i.test(r.error)) {
                await message(`${S.keyInvalid}\n${S.keyShort.replace(/^.*\n/, '')}`, 'Connect to a network', 'error');
                ctx.go('wlandlg:301');
                return;
            }
            // a key that did not work leaves no saved network behind (iwd keeps the provisioning file)
            if (p.pass && !p.wasKnown) Promise.resolve(h.forget(p.name)).catch(() => {});
            p.failed = true;
            ctx.go('wlanconn:107');
            return;
        }
        ctx.go('wlanconn:103');
    }

    async function runDisconnect(ctx) {
        const h = host();
        if (h) {
            try { await h.disconnect(); } catch (_) { /* the list shows what really happened */ }
        }
        if (!van || van.ctx !== ctx || !ctx.modal.isConnected) return;
        van.pending = null;
        ctx.reset('van:7111');
        void readList().then(vanPaint);
    }

    function keyCheck(pass) {
        if (!pass || pass.length < 8) return S.keyShort;
        // eslint-disable-next-line no-control-regex
        if (/[^\x20-\x7e]/.test(pass)) return S.keyAscii;
        if (pass.length > 63) return S.keyLong;
        return '';
    }

    function diagnose() {
        const s = state();
        const w = s.wifi || {};
        let text;
        let icon = 'info';
        if (!host() || !w.present) { text = S.noInterfaces; icon = 'warning'; } else if (w.radio === false) {
            text = 'The wireless network adapter is turned off. Turn it on in Network Connections or with the computer\'s wireless switch.';
            icon = 'warning';
        } else if (!current()) {
            text = 'This computer is not connected to a wireless network. Select a network in Connect to a network and click Connect.';
            scan();
        } else if (!(w.ip || []).length) {
            text = `${ADAPTER} is connected to ${current().name} but has not received an IP address. The network's router might not be responding.`;
            icon = 'warning';
        } else {
            text = `${ADAPTER} is connected to ${current().name} and has an IP address (${w.ip[0]}). No problems were found with this connection.`;
            const portal = root.DreamOSPortal;
            try { if (portal && typeof portal.check === 'function') portal.check(); } catch (_) { /* the host checks by itself */ }
        }
        return message(text, 'Melaton Network Diagnostics', icon);
    }

    async function openConnect() {
        if (van && van.ctx && live(van.ctx.modal)) {
            call('bringModalToFront', van.ctx.modal);
            scan();
            return van.ctx.modal;
        }
        const V = await kit();
        van = { ctx: null, filter: 'all', sel: null, pending: null, page: null };
        const mine = van;
        const shown = (key) => () => { if (van === mine) van.page = key; };
        const ctx = V.openWizard({
            id: 'dreamosWifiConnectModal',
            title: 'Connect to a network', // VAN 707
            icon: `${NET}/van-connect-16.png`,
            pages: [
                {
                    key: 'van:7111',
                    instruction: S.selectNetwork,
                    nextText: S.connect,
                    overrides: {
                        1014: { text: '', image: REFRESH },
                        1015: { skip: true },
                        1016: { skip: true },
                        1009: { html: '<div class="vdt-listview vdt-edge dwf-van-list" tabindex="0" role="listbox" aria-label="Networks"></div>', cls: 'dwf-van-holder' }
                    },
                    show: (c) => { shown('van:7111')(); footer(c, { firstPage: true }); vanPaint(); },
                    next: (c) => vanNext(c)
                },
                {
                    key: 'wlandlg:301',
                    instruction: S.typeKey,
                    nextText: S.connect,
                    overrides: { 408: { skip: true }, 407: { skip: true }, 409: { skip: true }, 410: { skip: true } },
                    show: (c) => {
                        shown('wlandlg:301')();
                        footer(c);
                        pageInstruction(c, 'wlandlg:301', fill(S.typeKey, van.pending ? van.pending.name : ''));
                        c.set(401, '', 'wlandlg:301');
                    },
                    next: async (c) => {
                        const pass = String(c.get(401, 'wlandlg:301') || '');
                        const bad = keyCheck(pass);
                        if (bad) {
                            await message(bad === S.keyAscii ? bad : `${S.keyInvalid}\n${bad.replace(/^.*\n/, '')}`, 'Connect to a network', 'error');
                            return false;
                        }
                        van.pending.pass = pass;
                        root.setTimeout(() => runConnect(c), 0);
                        return 'wlanconn:102';
                    }
                },
                {
                    key: 'wlanconn:101',
                    instruction: S.isUnsecured,
                    noNext: true,
                    show: (c) => { shown('wlanconn:101')(); footer(c); pageInstruction(c, 'wlanconn:101', fill(S.isUnsecured, van.pending ? van.pending.name : '')); }
                },
                {
                    key: 'wlanconn:102',
                    instruction: S.connecting,
                    noNext: true,
                    noBack: true,
                    transient: true,
                    overrides: {
                        3325: { image: `${NET}/wlanconn-computer-48.png` },
                        3329: { image: `${NET}/wlanconn-line-214.png`, cls: 'dwf-line' },
                        3330: { image: `${NET}/wlanconn-network-48.png` },
                        3331: { skip: true },
                        307: { skip: true }
                    },
                    show: (c) => {
                        shown('wlanconn:102')();
                        footer(c, { noBack: true });
                        const p = van.pending || {};
                        connectingPage(c, fill(p.disconnect ? S.disconnecting : S.connecting, p.name || ''));
                        const bar = c.holder(302, 'wlanconn:102');
                        if (bar) bar.classList.add('marquee');
                    }
                },
                {
                    key: 'wlanconn:103',
                    instruction: S.success,
                    finish: true,
                    noBack: true,
                    // one profile type (all users): the radios go and Start this connection automatically sits under Save this
                    // network where they were
                    overrides: { 340: { skip: true }, 3327: { skip: true }, 3336: { skip: true }, 3337: { skip: true }, 3338: { skip: true }, 3339: { nudge: [0, -75, 0, 0] } },
                    show: (c) => {
                        shown('wlanconn:103')();
                        const p = van.pending || {};
                        pageInstruction(c, 'wlanconn:103', fill(S.success, p.name || ''));
                        footer(c, { cancel: false, nextText: S.close, noBack: true });
                        c.set(336, true, 'wlanconn:103');
                        c.set(3339, p.wasKnown ? p.auto !== false : true, 'wlanconn:103');
                        c.enable(3339, true, 'wlanconn:103');
                        const n = c.content.querySelector('.vdt-wizard-next');
                        if (n) n.dataset.dialogPrimary = '1';
                    }
                },
                {
                    key: 'wlanconn:107',
                    instruction: S.cannot,
                    noNext: true,
                    noBack: true,
                    show: (c) => { shown('wlanconn:107')(); footer(c, { noBack: true }); pageInstruction(c, 'wlanconn:107', fill(S.cannot, van.pending ? van.pending.name : '')); }
                }
            ],
            init: (c) => {
                c.options(1004, [{ value: 'all', text: S.all }, { value: 'vpn', text: S.dialup }, { value: 'wireless', text: S.wireless }], 'all', 'van:7111');
                c.on(1004, 'change', () => { van.filter = String(c.get(1004, 'van:7111') || 'all'); vanPaint(); }, 'van:7111');
                c.on(1014, 'click', () => { scan(); void readList().then(vanPaint); }, 'van:7111');
                c.on(1009, 'change', (ev) => {
                    const row = ev.target.querySelector('.dwf-van-row.is-selected');
                    van.sel = row ? row.dataset.key : null;
                    vanButton();
                }, 'van:7111');
                c.on(1009, 'dblclick', (ev) => {
                    if (ev.target.closest('.dwf-van-row')) c.content.querySelector('.vdt-wizard-next').click();
                }, 'van:7111');
                c.on(1008, 'click', (ev) => { if (ev.target.closest('[data-link]')) void diagnose(); }, 'van:7111');
                c.on(1006, 'click', (ev) => { if (ev.target.closest('.vdt-link')) { c.close(); openNetworkCenter(); } }, 'van:7111');
                c.on(1007, 'click', (ev) => { if (ev.target.closest('.vdt-link')) { c.close(); openNetworkCenter(); } }, 'van:7111');
                c.on(1013, 'click', (ev) => { if (ev.target.closest('.vdt-link')) call('openExplorerApplet'); }, 'van:7111');
                c.on(402, 'change', () => {
                    const e = c.el(401, 'wlandlg:301');
                    if (e) e.type = c.get(402, 'wlandlg:301') ? 'text' : 'password';
                }, 'wlandlg:301');
                c.on(323, 'click', () => { c.go('wlanconn:102'); root.setTimeout(() => runConnect(c), 0); }, 'wlanconn:101');
                c.on(332, 'click', () => c.reset('van:7111'), 'wlanconn:101');
                c.on(336, 'change', () => c.enable(3339, !!c.get(336, 'wlanconn:103'), 'wlanconn:103'), 'wlanconn:103');
                c.on(339, 'click', () => { void diagnose(); }, 'wlanconn:107');
                c.on(340, 'click', () => { van.pending = null; c.reset('van:7111'); scan(); }, 'wlanconn:107');
            },
            finish: (c) => {
                // Close on the connected page: Save this network / Start this connection automatically
                const p = van && van.pending;
                const h = host();
                if (!p || !h) return true;
                const keep = !!c.get(336, 'wlanconn:103');
                const auto = !!c.get(3339, 'wlanconn:103');
                if (!keep) {
                    Promise.resolve(h.forget(p.name)).catch(() => {});
                    unremember(p.name);
                } else {
                    Promise.resolve(h.autoConnect(p.name, auto)).catch(() => {});
                    remember(p.name, p.security, auto);
                }
                return true;
            },
            close: () => {
                if (slowTimer) { root.clearTimeout(slowTimer); slowTimer = null; }
                if (van === mine) van = null;
            }
        });
        if (!ctx) { van = null; return null; }
        van.ctx = ctx;
        vanPaint();
        void readList().then(vanPaint);
        scan();
        return ctx.modal;
    }

    function openNetworkCenter() {
        const fl = root.featureLoader;
        Promise.resolve(fl && fl.loadFeature ? fl.loadFeature('control_panel') : null).then(() => {
            if (root.melatonControlPanel) root.melatonControlPanel.open('network');
        }).catch(() => {});
    }

    // ---- a network's properties (wlanui 17052 / 17053) --------------------------------------------------------------

    async function networkProperties(name, owner) {
        const V = await kit();
        const inRange = scanned.find((n) => n.name === name);
        const rec = saved().find((x) => x.name === name) || {};
        const security = (inRange && inRange.security) || rec.security || 'psk';
        const auto = inRange && inRange.autoConnect !== undefined && inRange.autoConnect !== null ? inRange.autoConnect !== false : rec.auto !== false;
        V.openSheet({
            id: 'dreamosWifiNetworkProps',
            title: fill(S.netProps, name),
            icon: `${NET}/wlanpref-manage-16.png`,
            owner,
            bareCaption: true,
            pages: [
                { key: 'wlanui:17052', overrides: { 15075: { skip: true }, 1107: { skip: true }, 1105: { disabled: true }, 1106: { disabled: true } } },
                { key: 'wlanui:17053', overrides: { 1114: { skip: true }, 1115: { skip: true }, 1116: { skip: true }, 1117: { skip: true }, 1118: { skip: true }, 1119: { skip: true }, 1120: { skip: true }, 1121: { skip: true }, 1124: { skip: true }, 1125: { skip: true }, 1126: { skip: true }, 1111: { disabled: true }, 1112: { disabled: true } } }
            ],
            init: (c) => {
                c.text(15081, name, 'wlanui:17052');
                c.text(1100, name, 'wlanui:17052');
                c.text(15073, S.accessPoint, 'wlanui:17052');
                c.text(1128, S.allUsers, 'wlanui:17052');
                c.set(1104, auto, 'wlanui:17052');
                c.options(1111, [SEC_TYPE[security] || SEC_TYPE.psk], SEC_TYPE[security] || SEC_TYPE.psk, 'wlanui:17053');
                c.options(1112, [SEC_CIPHER[security] || 'AES'], SEC_CIPHER[security] || 'AES', 'wlanui:17053');
                c.on(1104, 'change', () => c.dirty(), 'wlanui:17052');
            },
            apply: async (c) => {
                const on = !!c.get(1104, 'wlanui:17052');
                const h = host();
                if (h) {
                    const r = await Promise.resolve(h.autoConnect(name, on)).catch((e) => ({ error: String(e) }));
                    if (r && r.error) { await message(r.error, fill(S.netProps, name), 'error'); return; }
                }
                remember(name, security, on);
                mwnRerender();
            }
        });
    }

    // ---- Wireless Network Connection Properties (netshell 16004) ---------------------------------------------------

    const ITEMS = [
        { name: 'Internet Protocol Version 6 (TCP/IPv6)', text: 'TCP/IP version 6. The latest version of the internet protocol that provides communication across diverse interconnected networks.' },
        { name: 'Internet Protocol Version 4 (TCP/IPv4)', text: 'Transmission Control Protocol/Internet Protocol. The default wide area network protocol that provides communication across diverse interconnected networks.' }
    ];

    async function adapterProperties(owner) {
        const V = await kit();
        const w = state().wifi || {};
        V.openSheet({
            id: 'dreamosWifiAdapterProps',
            title: S.propsTitle,
            icon: `${NET}/netshell-wireless-16.png`,
            owner,
            noApply: true,
            pages: [{ key: 'netshell:16004', overrides: { 16006: { skip: true }, 15031: { disabled: true }, 15008: { disabled: true }, 15012: { disabled: true }, 15011: { disabled: true } } }],
            init: (c) => {
                c.set(15003, w.device || ADAPTER, 'netshell:16004');
                // GDI fits "Connect using:" in its 48 DLU; the browser's Tahoma is a little wider: keep it on one line
                c.content.querySelectorAll('.vdt-static').forEach((st) => { if (/^Connect using:/.test(st.textContent)) st.style.whiteSpace = 'nowrap'; });
                const lv = c.holder(15007, 'netshell:16004');
                const body = lv && lv.querySelector('.vdt-lv-body');
                if (!body) return;
                ITEMS.forEach((it, i) => {
                    const row = doc.createElement('div');
                    row.className = `vdt-lv-row dwf-item${i === 0 ? ' is-selected' : ''}`;
                    row.dataset.value = String(i);
                    const box = doc.createElement('input');
                    box.type = 'checkbox';
                    box.checked = true;
                    box.disabled = true;
                    box.id = `dwf-item-${i}`;
                    const lab = doc.createElement('label');
                    lab.htmlFor = box.id;
                    lab.textContent = it.name;
                    row.append(box, lab);
                    body.appendChild(row);
                });
                c.text(15020, ITEMS[0].text, 'netshell:16004');
                lv.addEventListener('change', () => {
                    const row = lv.querySelector('.vdt-lv-row.is-selected');
                    if (row) c.text(15020, ITEMS[Number(row.dataset.value)].text, 'netshell:16004');
                });
            }
        });
    }

    // ---- Wireless Network Connection Status (netshell 24050) and its Details (24300) -------------------------------

    let status = null; // { ctx, timer }

    function duration(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        const d = Math.floor(t / 86400);
        const hms = `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        return d ? `${d}${d === 1 ? S.day : S.days}${hms}` : hms;
    }

    function bytes(n) {
        return Number.isFinite(Number(n)) && n !== null ? Number(n).toLocaleString('en-US') : S.notAvailable;
    }

    function speed(mbps) {
        const v = Number(mbps);
        if (!Number.isFinite(v) || v <= 0) return S.notAvailable;
        return v >= 1000 ? `${(v / 1000).toFixed(1)} Gbps` : `${v.toFixed(1)} Mbps`; // netshell 23032 / 23033
    }

    function ipv4Text() {
        const w = state().wifi || {};
        if (!current()) return S.notConnected;
        if (!(w.ip || []).length) return S.limited;
        const portal = root.dreamosPortal && typeof root.dreamosPortal.captive === 'function' && root.dreamosPortal.captive();
        return !portal && (!root.navigator || root.navigator.onLine !== false) ? S.internet : S.local;
    }

    function ipv6Text() {
        const w = state().wifi || {};
        if (!current() || !Array.isArray(w.ip6) || !w.ip6.length) return S.notConnected;
        return w.ip6.some((a) => !/^fe80:/i.test(String(a))) ? S.internet : S.local;
    }

    function statusPaint() {
        if (!status || !status.ctx.modal.isConnected) return;
        const c = status.ctx;
        const k = 'netshell:24050';
        const n = current();
        const w = state().wifi || {};
        const set = (id, text) => { const h = c.holder(id, k); const t = h && h.querySelector('.vdt-st-text'); if (t) { if (t.textContent !== text) t.textContent = text; } else c.text(id, text, k); };
        set(23502, ipv4Text());
        set(23504, ipv6Text());
        set(1007, n ? S.enabled : S.disconnected);
        set(24018, n ? String(n.name) : '');
        set(1008, n && connectedSince ? duration(Date.now() - connectedSince) : '00:00:00');
        set(1009, n ? speed((n.speedMbps !== undefined ? n.speedMbps : w.speedMbps)) : S.notAvailable);
        set(1003, bytes(w.txBytes !== undefined ? w.txBytes : null));
        set(1005, bytes(w.rxBytes !== undefined ? w.rxBytes : null));
        const meter = c.holder(1044, k);
        const im = meter && meter.querySelector('img');
        const src = `${NET}/netshell-signal-${n ? signalLevel(n.signalPercent) : 0}-32.png`;
        if (im && im.getAttribute('src') !== src) {
            im.setAttribute('src', src);
            im.setAttribute('srcset', src.replace('.png', '@2x.png 2x'));
        }
        c.enable(23506, !!n, k);
        c.enable(24020, !!n, k);
    }

    function startStatusClock() {
        if (!status || status.timer) return;
        status.timer = root.setInterval(() => {
            if (!status || !status.ctx.modal.isConnected) { stopStatusClock(); return; }
            if (doc.hidden || status.ctx.modal.classList.contains('hidden')) return;
            const c = status.ctx;
            const n = current();
            const h = c.holder(1008, 'netshell:24050');
            const t = h && h.querySelector('.vdt-st-text');
            if (t && n && connectedSince) t.textContent = duration(Date.now() - connectedSince);
        }, 1000);
    }

    function stopStatusClock() {
        if (status && status.timer) { root.clearInterval(status.timer); status.timer = null; }
    }

    async function openDetails(owner) {
        const V = await kit();
        const w = state().wifi || {};
        const ips = w.ip && w.ip.length ? w.ip : [''];
        const rows = [['Connection-specific DNS Suffix', ''], ['Description', w.device || ''], ['Physical Address', w.mac || '']]
            .concat(ips.map((ip) => ['IPv4 IP Address', ip]))
            .concat([['IPv4 Subnet Mask', ''], ['IPv4 Default Gateway', ''], ['IPv4 DNS Server', ''], ['IPv4 WINS Server', ''], ['Link-local IPv6 Address', ''], ['IPv6 Default Gateway', ''], ['IPv6 DNS Server', '']]);
        V.openDialog({
            id: 'dreamosWifiDetails',
            key: 'netshell:24300',
            owner,
            bareCaption: true,
            init: (c) => {
                const lv = c.holder(24301);
                if (!lv) return;
                const head = lv.querySelector('.vdt-lv-header');
                const body = lv.querySelector('.vdt-lv-body');
                [['Property', 'dwf-col-prop'], ['Value', 'dwf-col-value']].forEach(([t, cls]) => {
                    const col = doc.createElement('span');
                    col.className = `vdt-lv-col ${cls}`;
                    col.textContent = t;
                    head.appendChild(col);
                });
                rows.forEach(([p, v]) => {
                    const row = doc.createElement('div');
                    row.className = 'vdt-lv-row';
                    const a = doc.createElement('span');
                    a.className = 'dwf-col-prop';
                    a.textContent = p;
                    const b = doc.createElement('span');
                    b.className = 'dwf-col-value';
                    b.textContent = v;
                    row.append(a, b);
                    body.appendChild(row);
                });
            }
        });
    }

    async function setRadio(on) {
        const h = host();
        if (!h || typeof h.radio !== 'function') return;
        const r = await Promise.resolve(h.radio(on)).catch((e) => ({ error: String(e) }));
        if (r && r.error) await message(r.error, ADAPTER, 'error');
    }

    async function openStatus() {
        if (!available()) { await message(S.noInterfaces, S.statusTitle, 'warning'); return null; }
        if (status && live(status.ctx.modal)) {
            call('bringModalToFront', status.ctx.modal);
            statusPaint();
            return status.ctx.modal;
        }
        const V = await kit();
        const k = 'netshell:24050';
        const right = [23502, 23504, 1007, 24018, 1008, 1009, 1003, 1005];
        const ctx = V.openSheet({
            id: 'dreamosWifiStatusModal',
            title: S.statusTitle,
            icon: `${NET}/netshell-wireless-16.png`,
            noApply: true,
            pages: [{
                key: k,
                overrides: {
                    // the signal quality meter: netshell 23510-23515 at their own 32 px, where the static sits
                    1044: { image: `${NET}/netshell-signal-0-32.png`, nudge: [0, 0, 2, 31] },
                    // the activity picture: the two screens (netshell 1915) under the wireless mark (1913), as
                    // netshell draws it, at 48 px
                    1010: { html: `<span class="dwf-activity">${img1('netshell-activity-48')}${img1('netshell-activity-wireless-48')}</span>` },
                    // the VM's status sheet shows Bytes only (no Errors row), one short rule between the counts
                    1027: { skip: true }, 1012: { skip: true }, 1013: { skip: true }, 1028: { skip: true }
                }
            }],
            init: (c) => {
                // the VM's values sit right-aligned in their column (the template's statics are left-aligned)
                right.forEach((id) => { const h = c.holder(id, k); if (h) h.style.textAlign = 'right'; });
                // Properties and Disable carry the UAC shield, as on the VM
                [1026, 1025].forEach((id) => {
                    const b = c.el(id, k);
                    if (b) b.insertAdjacentHTML('afterbegin', `<img class="dwf-shield" src="${SHIELD}" alt="" draggable="false">`);
                });
                c.on(23506, 'click', () => { void openDetails(c.modal); }, k);
                c.on(24020, 'click', () => { const n = current(); if (n) void networkProperties(String(n.name), c.modal); }, k);
                c.on(1026, 'click', () => { void adapterProperties(c.modal); }, k);
                c.on(1025, 'click', () => { void setRadio(false); c.close(); }, k);
                c.on(23505, 'click', () => { void diagnose(); }, k);
            },
            close: () => { stopStatusClock(); status = null; }
        });
        if (!ctx) return null;
        // the status sheet has one button, Close, where Cancel is (netshell 23020)
        const ok = ctx.content.querySelector('[data-vdt-action="ok"]');
        if (ok) ok.hidden = true;
        const cancel = ctx.content.querySelector('[data-vdt-action="cancel"]');
        if (cancel) { cancel.textContent = S.close; cancel.dataset.dialogPrimary = '1'; }
        // the caption shows the connection's icon on the VM
        const main = ctx.modal.querySelector('.modal-window-title > div');
        if (main && !main.querySelector('.icon-image')) main.insertAdjacentHTML('afterbegin', `<img class="icon-image" src="${NET}/netshell-wireless-16.png" alt="">`);
        status = { ctx, timer: null };
        statusPaint();
        startStatusClock();
        return ctx.modal;
    }

    // ---- Manage Wireless Networks (wlanpref.dll's folder, a Control Panel folder page) -----------------------------

    const MWN = 'manage-wireless-networks';
    const mwn = { sel: null };

    function mwnList() {
        const order = saved();
        const names = new Set(order.map((x) => x.name));
        // saved networks the host reports in range that this browser has not listed yet go to the end
        scanned.filter((n) => n.known && !names.has(n.name)).forEach((n) => order.push({ name: n.name, security: n.security, auto: n.autoConnect !== false }));
        return order.map((x) => {
            const live = scanned.find((n) => n.name === x.name);
            const auto = live && live.autoConnect !== undefined && live.autoConnect !== null ? live.autoConnect !== false : x.auto !== false;
            return { name: x.name, security: (live && live.security) || x.security || 'psk', auto };
        });
    }

    function mwnBar(list) {
        const sel = list.some((x) => x.name === mwn.sel);
        const i = list.findIndex((x) => x.name === mwn.sel);
        const btn = (v, icon, t, on = true) => `<button type="button" class="cpl-fbar-btn" data-cpl-vpage="${v}"${on ? '' : ' disabled'}>${icon ? img(icon) : ''}${esc(t)}</button>`;
        return `<div class="cpl-fbar" role="toolbar">
            ${btn('add', 'wlanpref-add-16', 'Add')}
            ${sel ? btn('remove', 'wlanpref-remove-16', 'Remove') : ''}
            ${sel ? btn('up', 'wlanpref-up-16', 'Move up', i > 0) : ''}
            ${sel ? btn('down', 'wlanpref-down-16', 'Move down', i < list.length - 1) : ''}
            ${btn('adapter', 'wlanpref-adapter-16', 'Adapter properties')}
            ${btn('profiles', 'wlanpref-profiles-16', 'Profile types')}
            ${btn('nsc', 'netcenter-16', 'Network and Sharing Center')}
            <button type="button" class="cpl-fbar-help" data-cpl-vpage="help" data-topic="manage-wireless-networks"><img src="/static_images/vista-explorer/help-16.png" alt=""></button>
        </div>`;
    }

    function mwnBody() {
        const list = mwnList();
        if (!list.some((x) => x.name === mwn.sel)) mwn.sel = null;
        const w = state().wifi || {};
        const bar = mwnBar(list);
        const tiles = list.map((x) => `<div class="cpl-ficon dwf-mwn-tile${x.name === mwn.sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-id="${esc(x.name)}" tabindex="0">${img('wlanpref-profile-32')}<span><b>${esc(x.name)}</b><br>Security: ${esc(SEC_MANAGE[x.security] || SEC_MANAGE.psk)}&nbsp;&nbsp;&nbsp;Type: ${esc(S.anySupported)}<br>${esc(x.auto ? S.automatic : S.manual)}</span></div>`).join('');
        const off = w.radio === false;
        const head = `<div class="cpl-vpage dwf-mwn-head"><h1 class="cpl-vtitle">${esc(fill(S.manageThat, ADAPTER))}</h1><p class="cpl-vtext">${esc(off ? S.wirelessOff : S.manageText)}</p></div>`;
        return `${bar}<div class="cpl-flist dwf-mwn-list">${head}<div class="vdt-lv-group">${esc(S.canModify)} (${list.length})</div><div class="cpl-flist-icons">${tiles}</div></div>`
            + `<div class="cpl-fstatus">${list.length} item${list.length === 1 ? '' : 's'}</div>`;
    }

    function mwnRerender() {
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.currentPage === 'function' && cp.currentPage() === MWN) cp.navigate(MWN, { replace: true });
    }

    function mwnMove(delta) {
        const list = mwnList();
        const i = list.findIndex((x) => x.name === mwn.sel);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        const [it] = list.splice(i, 1);
        list.splice(j, 0, it);
        storeSaved(list.map((x) => ({ name: x.name, security: x.security, auto: x.auto })));
        mwnRerender();
    }

    async function mwnRemove() {
        const name = mwn.sel;
        if (!name) return;
        const V = await kit();
        V.openDialog({
            id: 'dreamosWifiRemove',
            key: 'wlanpref:20060',
            bareCaption: true,
            overrides: { '-1': { image: `${NET}/wlanpref-warning-32.png` } },
            ok: async () => {
                const h = host();
                if (h) await Promise.resolve(h.forget(name)).catch(() => {});
                unremember(name);
                scanned = scanned.map((n) => (n.name === name ? { ...n, known: false, autoConnect: null } : n));
                mwn.sel = null;
                mwnRerender();
            }
        });
    }

    async function mwnAdd() {
        const V = await kit();
        V.openWizard({
            id: 'dreamosWifiAdd',
            title: S.addTitle,
            icon: `${NET}/wlanpref-manage-16.png`,
            pages: [{
                key: 'wlanpref:10102',
                instruction: S.addHow,
                noNext: true,
                // the host makes a profile only by connecting to a network in range
                overrides: { 10309: { disabled: true }, 10310: { disabled: true } }
            }],
            init: (c) => {
                c.on(10338, 'click', () => { c.close(); void openConnect(); }, 'wlanpref:10102');
            }
        });
    }

    async function mwnProfileTypes() {
        const V = await kit();
        V.openDialog({
            id: 'dreamosWifiProfileTypes',
            key: 'wlanpref:20068',
            bareCaption: true,
            overrides: { '-1': { image: `${NET}/wlanpref-profiletype-32.png` }, 20076: { disabled: true } },
            init: (c) => {
                c.set(20075, true);
                // the two icons have no ids (-1): wlanpref 20073, then the warning 20061, in template order
                const icons = c.content.querySelectorAll('.vdt-image img');
                ['wlanpref-profiletype-32', 'wlanpref-warning-32'].forEach((name, i) => {
                    if (!icons[i]) return;
                    icons[i].src = `${NET}/${name}.png`;
                    icons[i].srcset = `${NET}/${name}@2x.png 2x`;
                });
            }
        });
    }

    function registerManage() {
        const cp = root.melatonControlPanel;
        const K = root.cplPages;
        if (!cp || typeof cp.registerPage !== 'function') return false;
        // Control Panel keeps the first registration of a page id: its body asks this file's current copy (a live
        // update of this file replaces window.dreamosWifi), so the page and the handlers below never part
        cp.registerPage(MWN, { kind: 'folder', title: () => S.manage, icon16: `${NET}/wlanpref-manage-16.png`, tasks: () => '', body: () => (root.dreamosWifi && root.dreamosWifi._manageBody ? root.dreamosWifi._manageBody() : '') });
        if (K && K.handlers) {
            K.handlers[MWN] = {
                pick(t) {
                    // select in place (a re-render between the two clicks would swallow a double-click) and
                    // redraw only the command bar, whose Remove / Move up / Move down follow the selection
                    mwn.sel = t.dataset.id;
                    t.parentElement.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
                    t.classList.add('is-selected');
                    const win = t.closest('.cpl-instance');
                    const bar = win && win.querySelector('.cpl-fbar');
                    if (bar) bar.outerHTML = mwnBar(mwnList());
                },
                open(id) { void networkProperties(id); },
                add() { void mwnAdd(); },
                remove() { void mwnRemove(); },
                up() { mwnMove(-1); },
                down() { mwnMove(1); },
                adapter() { void adapterProperties(); },
                profiles() { void mwnProfileTypes(); },
                nsc() { cp.open('network'); }
            };
            if (typeof K.wire === 'function') K.wire();
        }
        return true;
    }

    async function openManage() {
        if (!available()) { await message(S.noInterfaces, S.manage, 'warning'); return; }
        const fl = root.featureLoader;
        await Promise.resolve(fl && fl.loadFeature ? fl.loadFeature('control_panel') : null);
        await kit();
        if (!registerManage()) return;
        await readList();
        root.melatonControlPanel.open(MWN);
    }

    // ---- the host's pushes ------------------------------------------------------------------------------------------

    function onNet() {
        noteConnection();
        vanPaint();
        statusPaint();
        mwnRerender();
    }

    root.addEventListener('dreamosnet', onNet, { signal: appScopeSignal });
    root.addEventListener('dreamosnetscan', (ev) => {
        const d = ev && ev.detail;
        setList(d && Array.isArray(d.networks) ? d.networks : null);
        vanPaint();
        mwnRerender();
    }, { signal: appScopeSignal });
    root.addEventListener('nightshade:state', vanPaint, { signal: appScopeSignal });
    noteConnection();

    root.dreamosWifi = { openConnect, openManage, openStatus, available, signalLevel, _manageBody: mwnBody };
})(typeof window !== 'undefined' ? window : globalThis);
