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
 *                                Properties, Properties (netshell 16004), Disable, Diagnose; a wired adapter's
 *                                Local Area Connection Status is netshell 23500. Speed, Bytes, Duration and the
 *                                Details come from provider.stats(), read once a second while the sheet is seen
 *   Network Connections          ncpa.cpl as a Control Panel folder page: the adapters (provider.interfaces(), else
 *                                the state) and the Nightshade Network as Vista's tiles, the command bar per
 *                                selection (Enable / Disable this network device: enable(iface, on), Wi-Fi radio(on);
 *                                Diagnose, Rename in place, View status, Change settings)
 *   Adapter Properties           netshell 16004 for any adapter; Internet Protocol Version 4 (TCP/IPv4) > Properties
 *   TCP/IPv4 Properties          tcpipcfg 2323 (General) and 2334 (Alternate Configuration) with the kit's IP address
 *                                control, checked as tcpipcfg checks (its message boxes), applied with
 *                                provider.ipConfig(iface, ...), greyed without can().ipConfig
 *   Set up a connection or       xwizards' list (connect 305) and connect.dll's / wlanpref.dll's pages: Connect to the
 *   network                      Internet (connect 103 / 503 / 107 / 109), Manually connect to a wireless network
 *                                (wlanpref 10101 / 10103 / 10104), Connect to a workplace (the Nightshade client);
 *                                a router, ad hoc network or dial-up modem: "The wizard cannot continue" (connect 701)
 *
 *   window.dreamosWifi = { openConnect(), openManage(), openStatus(), openVpnStatus(), openMobileStatus(),
 *                          openConnections(), openSetup(), setRadio(on),
 *                          radioOff(), available(), signalLevel(percent) }
 *
 * Nothing polls: the host pushes 'dreamosnet' (state) and 'dreamosnetscan' (a scan's list); opening Connect to a
 * network and its Refresh button ask for a scan. The status sheet's Duration counts on a local clock while it
 * shows. Without a network tray provider (a browser, the phone) there is no wireless adapter: Connect to a network
 * lists only the Dial-up and VPN connection, as Vista does on a computer without one, and the other two windows
 * say that no wireless network interface was found.
 *
 * Manage Wireless Networks lists provider.known() and sets the priority order with provider.order(names) (drag a
 * network up or down, or Move up / Move down); a provider without them leaves the order to this browser
 * (localStorage), together with the saved networks seen out of range. Each Round 2 method is feature-tested.
 */
(function (root) {
    'use strict';

    const doc = root.document;
    // the 'network' tray provider (trayProviders.js, docs/client-api/tray-providers.md): DreamOS's DreamOSNetwork
    // wrapper, the Android app's desktop shell
    const host = () => (root.melatonTray && root.melatonTray.provider('network')) || null;
    /** What the adapter allows (provider.can(): { connect, forget, radio, scan }; absent = everything it has). */
    function can(op) {
        const h = host();
        if (!h || typeof h[op] !== 'function') return false;
        let c = null;
        try { c = typeof h.can === 'function' ? h.can() : null; } catch (_) { c = null; }
        return !c || c[op] !== false;
    }
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
        "tcpipcfg:2308": {"t":"IP Settings","w":252,"h":218,"f":["MS Shell Dlg",8],"s":1355284552,"c":[[-1,"B",7,7,238,81,1342177287,"IP add&resses",0],[1016,"SysListView32",16,20,220,43,1350664205,"Generic1",0],[1017,"B",78,67,50,14,1342242816,"&Add...",0],[1018,"B",132,67,50,14,1342242816,"&Edit...",0],[1019,"B",186,67,50,14,1342242816,"Remo&ve",0],[-1,"B",7,92,238,81,1342177287,"De&fault gateways:",0],[1004,"SysListView32",16,105,220,43,1350664205,"Generic1",0],[1020,"B",78,152,50,14,1342242816,"A&dd...",0],[1021,"B",132,152,50,14,1342242816,"Edi&t...",0],[1022,"B",186,152,50,14,1342242816,"Re&move",0],[-1,"B",7,180,238,31,1342177287,"",0],[1030,"B",13,180,66,9,1342242819,"A&utomatic metric",0],[1073,"S",15,195,57,8,1342308352,"I&nterface metric:",0],[1029,"E",80,193,50,12,1350639744,"",0]]},
        "tcpipcfg:2322": {"t":"DNS","w":252,"h":238,"f":["MS Shell Dlg",8],"s":1354760264,"c":[[-1,"S",7,7,167,8,1342308352,"D&NS server addresses, in order of use:",0],[1040,"L",7,17,214,36,1352728835,"",0],[1041,"B",63,57,50,14,1342242816,"&Add...",0],[1042,"B",117,57,50,14,1342242816,"&Edit...",0],[1043,"B",171,57,50,14,1342242816,"Remo&ve",0],[1044,"B",227,17,18,16,1342242880,"Up",0],[1045,"B",227,37,18,16,1342242880,"Down",0],[1059,"S",7,77,224,17,1342308352,"The following three settings are applied to all connections with TCP/IP enabled. For resolution of unqualified names:",0],[1046,"B",7,97,230,10,1342383113,"Append &primary and connection specific DNS suffixes",0],[1047,"B",20,109,201,10,1342252035,"Append parent suffi&xes of the primary DNS suffix",0],[1048,"B",7,121,201,10,1342252041,"Append t&hese DNS suffixes (in order):",0],[1049,"L",7,133,214,36,1352728835,"",0],[1050,"B",63,173,50,14,1342242816,"A&dd...",0],[1051,"B",117,173,50,14,1342242816,"Edi&t...",0],[1052,"B",171,173,50,14,1342242816,"Re&move",0],[1053,"B",227,133,18,16,1342242880,"Up",0],[1054,"B",227,153,18,16,1342242880,"Down",0],[1032,"S",7,197,100,8,1342308352,"DNS &suffix for this connection:",0],[1031,"msctls_netaddress",108,194,113,14,1350631552,"",0],[1057,"B",7,209,214,12,1342242819,"&Register this connection's addresses in DNS",0],[1058,"B",7,220,214,12,1342242819,"&Use this connection's DNS suffix in DNS registration",0]]},
        "tcpipcfg:2324": {"t":"WINS","w":252,"h":218,"f":["MS Shell Dlg",8],"s":1354760264,"c":[[-1,"B",7,7,238,78,1342177287,"&WINS addresses, in order of use:",0],[1060,"L",16,20,193,39,1352728835,"",0],[1061,"B",51,64,50,14,1342242816,"&Add...",0],[1062,"B",105,64,50,14,1342242816,"&Edit...",0],[1063,"B",159,64,50,14,1342242816,"Remo&ve",0],[1064,"B",218,20,18,16,1342242880,"&Up",0],[1065,"B",218,40,18,16,1342242880,"&Down",0],[1072,"S",7,89,238,18,1342308352,"If LMHOSTS lookup is enabled, it applies to all connections for which TCP/IP is enabled.",0],[1066,"B",7,111,107,10,1342242819,"Enable &LMHOSTS lookup",0],[1067,"B",155,109,90,14,1342242816,"I&mport LMHOSTS...",0],[-1,"B",7,131,238,80,1342177287,"NetBIOS setting",0],[1074,"S",31,152,205,27,1342308352,"Use NetBIOS setting from the DHCP server. If static IP address is used or the DHCP server does not provide NetBIOS setting, enable NetBIOS over TCP/IP.",0],[1070,"B",14,142,153,10,1342373897,"De&fault:",0],[1068,"B",14,182,169,10,1342242825,"E&nable NetBIOS over TCP/IP",0],[1069,"B",14,195,169,10,1342242825,"Di&sable NetBIOS over TCP/IP",0]]},
        "netshell:16001": {"t":"Select Network Feature Type","w":200,"h":153,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[15006,"SysListView32",7,26,186,40,1350680589,"",0],[15009,"B",86,132,50,14,1342242817,"&Add...",0],[2,"B",143,132,50,14,1342242816,"Cancel",0],[-1,"S",7,15,186,8,1342308352,"&Click the type of network feature you want to install:",0],[-1,"B",7,70,186,52,1342177287,"Description",0],[15019,"S",16,83,168,32,1342308352,"",0]]},
        "netshell:10751": {"t":"Sharing","w":227,"h":189,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[103,"B",7,8,213,97,1342177287,"Internet Connection Sharing",0],[104,"B",7,8,213,117,1073741831,"Internet Connection Sharing",0],[115,"B",7,8,213,52,1073741831,"Internet Connection Sharing",0],[105,"B",14,24,194,16,1342252035,"Allow other &network users to connect through this computer's Internet connection",0],[106,"S",26,47,189,8,1208090624,"&Home networking connection:",0],[107,"C",26,58,189,50,1075904515,"",0],[108,"E",26,58,189,12,1073809536,"",512],[109,"B",14,58,188,16,1342252035,"All&ow other network users to control or disable the shared Internet connection",0],[110,"S",15,78,194,1,1207959568,"",0],[111,"SysLink",15,82,138,20,1342242816,"<A>Using ICS (Internet Connection Sharing)</A>",0],[112,"B",164,82,50,14,1342242816,"Settin&gs...",0]]},
        "netshell:24100": {"t":"General","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[23501,"S",17,21,100,8,1342308352,"IPv4 Connectivity:",0],[23502,"S",110,21,100,8,1342308352,"None",4096],[23503,"S",17,33,100,8,1342308352,"IPv6 Connectivity:",0],[23504,"S",110,33,100,8,1342308352,"None",4096],[1032,"S",17,45,100,8,1342308352,"Media State:",0],[1007,"S",73,45,137,8,1342308352,"Disconnected",4096],[1033,"S",17,57,100,8,1342308352,"Duration:",0],[1008,"S",73,57,137,8,1342308352,"00:00:00",4096],[1034,"S",17,69,100,8,1342308352,"Speed:",0],[1009,"S",73,69,137,8,1342308352,"0 bps",4096],[23506,"B",17,83,50,14,1342242816,"D&etails...",0],[1035,"S",54,127,41,8,1342308352,"Sent",4096],[1030,"S",99,131,13,1,1342177288,"",0],[1010,"S",121,120,21,20,1342177283,"#210",0],[1031,"S",156,131,13,1,1342177288,"",0],[1036,"S",174,127,35,8,1342308352,"Received",4096],[1023,"S",17,149,34,8,1342308352,"Bytes:",0],[1003,"S",52,149,63,8,1342308352,"0",4096],[1028,"S",134,149,1,30,1342177288,"",0],[1029,"S",134,149,1,10,1342177288,"",0],[1005,"S",149,149,61,8,1342308352,"0",4096],[1037,"S",17,161,43,8,1342308352,"Compression:",0],[1004,"S",73,161,42,8,1342308352,"0 %",4096],[1006,"S",168,161,42,8,1342308352,"0 %",4096],[1027,"S",17,172,32,8,1342308352,"Errors:",0],[1012,"S",69,172,46,8,1342308352,"0",4096],[1013,"S",164,172,46,8,1342308352,"0",4096],[-1,"S",7,106,25,8,1342308352,"Activity",0],[-1,"S",35,110,184,1,1342177296,"",0],[-1,"S",7,9,37,8,1342308352,"Connection",0],[-1,"S",50,13,170,1,1342177296,"",0],[1026,"B",7,192,55,14,1342242816,"&Properties",0],[1025,"B",65,192,55,14,1342242816,"&Disable",0],[23505,"B",123,192,55,14,1342242816,"Dia&gnose",0]]},
        "netshell:24200": {"t":"Details","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[24202,"B",162,131,50,14,1342242816,"&Suspend",0],[24206,"C",16,111,196,45,1344340227,"",0],[24203,"S",17,134,85,8,1342308352,"Number of active devices:",0],[24204,"S",110,134,20,8,1342308352,"0",0],[24205,"SysListView32",7,7,213,77,1350631425,"List1",0],[24201,"S",9,99,26,8,1342308352,"Devices",0],[24207,"S",47,102,172,1,1342177296,"",0]]},
        "netshell:16004": {"t":"Networking","w":227,"h":226,"f":["MS Shell Dlg",8],"s":1220542528,"c":[[65535,"S",7,7,48,8,1342308352,"Connect using:",0],[15021,"E",7,18,213,18,1484785792,"",0],[15003,"E",28,21,182,12,1342179456,"",0],[16006,"S",12,20,16,16,1073741827,"",0],[15031,"B",160,39,60,14,1342242816,"&Configure...",0],[16055,"S",7,54,213,8,1342308352,"This c&onnection uses the following items:",0],[15007,"SysListView32",7,66,213,86,1350680589,"",0],[15008,"B",7,156,67,14,1342242816,"I&nstall...",0],[15012,"B",80,156,67,14,1342242816,"&Uninstall",0],[15011,"B",153,156,67,14,1342242816,"P&roperties",0],[16056,"B",7,173,213,42,1342177287,"Description",0],[15020,"S",16,184,196,28,1342308352,"",0]]},
        "wlanui:17052": {"t":"Connection","w":235,"h":213,"f":["MS Shell Dlg",8],"s":1086849224,"c":[[15080,"S",9,14,48,8,1342308352,"Name:",0],[15081,"S",82,14,140,8,1342324864,"Profile name",0],[1101,"S",9,27,48,8,1342308352,"SSID:",0],[15071,"S",9,40,48,8,1342308352,"Network Type:",0],[1100,"S",82,27,140,8,1342324864,"some ssid network",0],[15073,"S",82,40,140,8,1342324736,"??? network",0],[1127,"S",9,53,70,8,1342308352,"Network Availability:",0],[1128,"S",82,53,140,8,1342324736,"some rights",0],[1104,"B",10,77,206,10,1342252035,"Connect auto&matically when this network is in range",0],[1105,"B",10,90,206,12,1342252035,"Connect to a more &preferred network if available",0],[1106,"B",10,103,206,10,1342252035,"C&onnect even if the network is not broadcasting",0],[15075,"B",10,116,206,10,1342242819,"&Enable %s connection settings",0],[1107,"B",21,129,50,15,1342242816,"&Configure...",0]]},
        "wlanui:17053": {"t":"Security","w":235,"h":245,"f":["MS Shell Dlg",8],"s":1220542536,"c":[[1110,"S",9,21,67,10,1342308352,"S&ecurity type:",0],[1111,"C",81,19,123,80,1344339971,"",0],[1113,"S",9,38,63,10,1342308352,"E&ncryption type:",0],[1112,"C",81,36,123,53,1344339971,"",0],[1114,"S",9,55,68,8,1073872896,"Network security &key",0],[1115,"E",81,53,123,14,1082196128,"",0],[1116,"E",81,53,123,14,1082196096,"",0],[1117,"B",81,73,77,10,1073807363,"S&how characters",0],[1126,"S",9,93,67,10,1073872896,"Key &Index:",0],[1125,"C",81,91,20,80,1344339971,"",0],[1124,"B",155,53,50,15,1342242816,"&Configure...",0],[1118,"S",9,85,200,8,1342308352,"Ch&oose a network authentication method:",0],[1119,"C",9,95,143,70,1344339971,"",0],[1120,"B",155,94,50,15,1342242816,"&Settings...",0],[1121,"B",10,112,178,16,1342251011,"C&ache user information for subsequent connections to this network",0]]},
        "wlanpref:20060": {"t":"Manage Wireless Networks - Warning!","w":260,"h":79,"f":["Segoe UI",9],"s":2160591048,"c":[[-1,"S",5,5,25,25,1342177283,"",0],[20062,"S",30,5,250,50,1342308352,"If you remove this network from the list you will\nno longer be able to connect to it automatically.\n\nDo you wish to proceed?",0],[1,"B",150,60,50,14,1342242816,"OK",0],[2,"B",205,60,50,14,1342242816,"Cancel",0]]},
        "wlanpref:10102": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":2160591048,"c":[[10338,"B",4,0,280,42,1342242830,"&Add a network that is in range of this computer\nThis shows you a list of networks that are currently available and lets you connect to one. Once you connect, a profile for the network is saved on your computer.",0],[10309,"B",4,47,280,52,1342242830,"&Manually create a network profile\nThis creates a new network profile or locates an existing network and saves a profile for the network on your computer. You need to know the network name (SSID) and security key (if applicable).",0],[10310,"B",4,104,280,35,1342242830,"&Create an ad hoc network\nThis creates a temporary network for sharing files or an Internet connection",0]]},
        "tcpipcfg:2323": {"t":"General","w":252,"h":218,"f":["MS Shell Dlg",8],"s":1354760264,"c":[[1008,"S",7,7,229,32,1342308352,"You can get IP settings assigned automatically if your network supports this capability. Otherwise, you need to ask your network administrator for the appropriate IP settings.",0],[-1,"B",7,58,238,62,1342177287,"",0],[1000,"B",13,44,223,10,1342383113,"&Obtain an IP address automatically",0],[1001,"B",13,57,105,10,1342243849,"U&se the following IP address:",0],[1005,"S",16,72,85,8,1342308352,"&IP address:",0],[1002,"SysIPAddress32",132,70,83,12,1342242944,"",0],[1006,"S",16,88,88,8,1342308352,"S&ubnet mask:",0],[1003,"SysIPAddress32",132,86,83,12,1342242944,"",0],[1007,"S",16,104,93,8,1342308352,"&Default gateway:",0],[1004,"SysIPAddress32",132,102,83,12,1342242944,"",0],[-1,"B",7,141,238,46,1342177287,"",0],[1009,"B",13,127,223,10,1342383113,"O&btain DNS server address automatically",0],[1010,"B",13,140,141,10,1342243849,"Us&e the following DNS server addresses:",0],[1013,"S",16,155,93,8,1342308352,"&Preferred DNS server:",0],[1011,"SysIPAddress32",132,153,83,12,1342242944,"",0],[1014,"S",16,171,95,8,1342308352,"&Alternate DNS server:",0],[1012,"SysIPAddress32",132,169,83,12,1342242944,"",0],[1015,"B",185,197,60,14,1342242816,"Ad&vanced...",0]]},
        "tcpipcfg:2334": {"t":"Alternate Configuration","w":252,"h":218,"f":["MS Shell Dlg",8],"s":1354760264,"c":[[-1,"S",7,7,238,20,1342308352,"If this computer is used on more than one network, enter the alternate IP settings below.",0],[-1,"B",7,48,238,158,1342177287,"",0],[1070,"B",16,34,213,10,1342374921,"Au&tomatic private IP address",0],[1071,"B",16,48,65,10,1342243849,"U&ser configured",0],[1072,"S",18,64,91,8,1342308352,"&IP address:",0],[1073,"SysIPAddress32",134,62,83,12,1342242816,"",0],[1074,"S",18,80,96,8,1342308352,"S&ubnet mask:",0],[1075,"SysIPAddress32",134,78,83,12,1342242816,"",0],[1076,"S",18,96,95,8,1342308352,"&Default gateway:",0],[1077,"SysIPAddress32",134,94,83,12,1342242816,"",0],[1078,"S",17,120,97,8,1342308352,"&Preferred DNS server:",0],[1079,"SysIPAddress32",133,118,83,12,1342242816,"",0],[1080,"S",17,136,94,8,1342308352,"&Alternate DNS server:",0],[1081,"SysIPAddress32",133,134,83,12,1342242816,"",0],[1082,"S",18,160,98,8,1342308352,"Preferred &WINS server:",0],[1083,"SysIPAddress32",134,158,83,12,1342242816,"",0],[1084,"S",18,176,96,8,1342308352,"Alternate WI&NS server:",0],[1085,"SysIPAddress32",134,174,83,12,1342242816,"",0]]},
        "wlanpref:10101": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":2160591048,"c":[[-1,"S",7,5,50,8,1342308352,"N&etwork name:",0],[10303,"E",98,2,123,14,1350631552,"",0],[-1,"S",7,23,46,8,1342308352,"&Security type:",0],[10305,"C",98,22,123,30,1344339971,"",0],[-1,"S",7,43,54,8,1342308352,"Enc&ryption type:",0],[10306,"C",98,41,123,30,1344339971,"",0],[-1,"S",7,63,80,8,1342308352,"Se&curity Key/Passphrase:",0],[10304,"E",98,61,123,14,1350631584,"",0],[10307,"B",227,63,75,10,1342242819,"&Display characters",0],[10335,"S",0,82,16,16,1342179331,"#10407",0],[10336,"B",12,81,250,10,1342373897,"Save this network for &all users of this computer",0],[10337,"B",12,93,250,10,1342242825,"Save this network for &me only",0],[10328,"B",12,110,206,10,1342242819,"S&tart this connection automatically",0],[10334,"B",12,124,250,10,1342242819,"C&onnect even if the network is not broadcasting",0],[10339,"S",22,136,250,9,1342308352,"Warning: If you select this option, your computer’s privacy might be at risk.",0]]},
        "wlanpref:10103": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":2160591048,"c":[[-1,"S",56,10,48,48,1342179331,"#10404",0],[-1,"S",88,10,118,48,1342179331,"#10405",0],[-1,"S",210,10,48,48,1342179331,"#10406",0],[10301,"msctls_progress32",74,62,152,8,1350565896,"",0]]},
        "wlanpref:10104": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":2160591048,"c":[[10313,"B",10,10,250,30,1342242830,"&Connect to...\nOpen the \"Connect to a network\" dialog so I can connect.",0],[10314,"B",10,50,250,30,1342242830,"C&hange connection settings\nOpen the connection properties so that I can change the settings.",0]]},
        "connect:305": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1051,"S",1,1,1,1,1342308352,"",0],[2101,"SysListView32",5,5,305,135,1350680589,"List1",0]]},
        "connect:103": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1701,"S",60,10,48,48,1342179331,"#11100",0],[1702,"S",88,10,118,48,1342179331,"#11103",0],[1703,"S",210,10,48,48,1342179331,"#11106",0],[1401,"B",30,70,235,23,1342242830,"Browse the &Internet now",0],[1402,"B",30,98,235,23,1342242830,"&Set up a new connection anyway",0]]},
        "connect:503": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1401,"B",5,3,300,38,1342242830,"",0],[1402,"B",5,43,300,38,1342242830,"",0],[1403,"B",5,83,300,38,1342242830,"",0],[2101,"SysListView32",5,3,305,103,1350680589,"List1",0],[1301,"B",10,123,300,10,1342251011,"&Show connection options that this computer is not set up to use",0],[1501,"SysLink",10,135,200,20,1342242818,"<A>Help me choose</A>",0]]},
        "connect:107": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1701,"S",60,10,48,48,1342179331,"#11100",0],[1702,"S",88,10,118,48,1342179331,"#11103",0],[1703,"S",210,10,48,48,1342179331,"#11106",0],[2502,"msctls_progress32",74,62,152,8,1350565896,"Test Internet Connection",0]]},
        "connect:109": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1701,"S",60,10,48,48,1342179331,"#11100",0],[1702,"S",88,10,118,48,1342179331,"#11103",0],[1703,"S",210,10,48,48,1342179331,"#11107",0],[1401,"B",30,55,235,23,1342242830,"&Try again",0],[1402,"B",30,81,235,23,1342242830,"&Diagnose the problem",0],[1403,"B",30,107,235,23,1342242830,"&Set up the connection anyway",0]]},
        "netshell:23500": {"t":"General","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[23501,"S",17,21,100,8,1342308352,"IPv4 Connectivity:",0],[23502,"S",110,21,100,8,1342308352,"None",4096],[23503,"S",17,33,100,8,1342308352,"IPv6 Connectivity:",0],[23504,"S",110,33,100,8,1342308352,"None",4096],[1032,"S",17,45,100,8,1342308352,"Media State:",0],[1007,"S",73,45,137,8,1342308352,"Disconnected",4096],[1033,"S",17,57,100,8,1342308352,"Duration:",0],[1008,"S",73,57,137,8,1342308352,"00:00:00",4096],[1034,"S",17,69,100,8,1342308352,"Speed:",0],[1009,"S",73,69,137,8,1342308352,"0 bps",4096],[23506,"B",17,83,50,14,1342242816,"D&etails...",0],[1035,"S",54,143,41,8,1342308352,"Sent",4096],[1030,"S",99,147,13,1,1342177288,"",0],[1010,"S",121,136,21,20,1342177283,"",0],[1031,"S",156,147,13,1,1342177288,"",0],[1036,"S",174,143,35,8,1342308352,"Received",4096],[1023,"S",17,166,34,8,1342308352,"Bytes:",0],[1003,"S",52,166,63,8,1342308352,"0",4096],[1028,"S",134,166,1,21,1342177288,"",0],[1029,"S",134,166,1,10,1342177288,"",0],[1005,"S",149,166,61,8,1342308352,"0",4096],[1027,"S",17,178,32,8,1342308352,"Errors:",0],[1012,"S",69,178,46,8,1342308352,"0",4096],[1013,"S",164,178,46,8,1342308352,"0",4096],[-1,"S",7,122,25,8,1342308352,"Activity",0],[-1,"S",35,126,184,1,1342177296,"",0],[-1,"S",7,9,37,8,1342308352,"Connection",0],[-1,"S",49,13,170,1,1342177296,"",0],[1026,"B",7,192,55,14,1342242816,"&Properties",0],[1025,"B",65,192,55,14,1342242816,"&Disable",0],[23505,"B",123,192,55,14,1342242816,"Dia&gnose",0]]},
        "connect:701": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1051,"S",1,1,1,1,1342308352,"",0],[1052,"S",10,5,290,40,1342308352,"The wizard is unable to continue and needs to be closed. You can try running it again later. If the problem persists, please contact your system administrator or technical support.",0],[1301,"B",10,45,290,10,1342242819,"&Show me more details",0],[1053,"RICHEDIT",10,55,290,85,1353779204,"",0]]},
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
        if (!h || !can('scan')) return;
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
        const vpn = [{ kind: 'vpn', key: 'v:nightshade', name: ns.name, connected: ns.connected }]
            // (#952) Dial-up and VPN: the phone's VPN apps' tunnels and this computer's workplace connections, as Vista lists
            // every connection of its phone book here
            .concat((ifaces || []).filter((x) => x && x.kind === 'vpn' && x.nc).map((x) => ({ kind: 'vpn', key: `v:tun:${x.name}`, name: x.vpnSession || x.vpnApp || x.name, connected: !!x.connected, row: x })))
            .concat(vpnObjects().map((o) => { const r = vpnObjectRow(o); return { kind: 'vpn', key: `v:vo:${o.id}`, name: o.name, connected: r.connected, vo: o }; }));
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
        next.disabled = !r || (r.kind === 'wifi' && !can(r.connected ? 'disconnect' : 'connect'));
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
        if (r.kind === 'vpn' && r.vo) {
            // a workplace connection: Vista's Connect <name> (or its status while it is up)
            ctx.close();
            if (r.connected) void openStatus(vpnAdapter());
            else void vpnLib().then((lib) => lib && lib.openConnect(r.vo.id));
            return false;
        }
        if (r.kind === 'vpn' && r.row) {
            // a VPN app's tunnel: connected or disconnected through its app
            ctx.close();
            if (!vpnControl(r.row, !r.connected)) { const h = host(); if (h && typeof h.openVpnApp === 'function') h.openVpnApp(r.row.name); }
            return false;
        }
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
                c.on(1006, 'click', (ev) => { if (ev.target.closest('.vdt-link')) { c.close(); void openSetup(); } }, 'van:7111');
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

    // ---- the computer's network adapters: provider.interfaces() (Round 2), else what its state shows ----------------

    const LAN = 'Local Area Connection'; // netshell 1812
    const MOBILE = 'Mobile Broadband Connection';
    // Network Connections' words (netshell.dll.mui)
    const N = {
        title: 'Network Connections', // 1060
        lan: 'LAN or High-Speed Internet', vpnGroup: 'Virtual Private Network', broadband: 'Broadband', // 1022 / 1024 / 1031
        unplugged: 'Network cable unplugged', disabled: 'Disabled', notConnected: 'Not connected', // 1047 / 1048 / 1056
        limited: 'Limited or no connectivity', connected: 'Connected', disconnectedVpn: 'Disconnected', // 1039 / 1042 / 1040
        network: 'Network',
        start: 'Start this connection', stop: 'Disconnect this connection', diagnose: 'Diagnose this connection', // 1530 / 1535 / 1540
        rename: 'Rename this connection', status: 'View status of this connection', remove: 'Delete this connection', // 1550 / 1555 / 1560
        enable: 'Enable this network device', disable: 'Disable this network device', // 1565 / 1570
        settings: 'Change settings of this connection', connectTo: 'Connect To', // 1575 / 1602
        props: '%1 Properties', statusOf: '%1 Status', // 1057 / 23041
        renameTitle: 'Error Renaming Connection', // 1061
        renameExists: 'Cannot rename this connection. A connection with the name you specified already exists. Specify a different name.', // 1062
        renameChars: 'Cannot rename this connection. A connection name cannot contain tabs, only spaces, or any of the following characters: \\/:*?<>|"', // 1064
        disableTitle: 'Error Disabling Connection', // 1074
        disableFail: 'It is not possible to disable the connection at this time. This connection may be using one or more protocols that do not support Plug-and-Play, or it may have been initiated by another user or the system account.', // 1075
        cols: ['Name', 'Status', 'Device Name', 'Connectivity', 'Network Category', 'Owner', 'Type', 'Phone # or Host Address'] // 1000-1019
    };

    let ifaces = null; // provider.interfaces()'s last answer
    function readIfaces() {
        const h = host();
        if (!h || typeof h.interfaces !== 'function') return Promise.resolve(null);
        return Promise.resolve(h.interfaces()).then((r) => {
            ifaces = r && Array.isArray(r.interfaces) ? r.interfaces.filter((x) => x && x.name) : null;
            return ifaces;
        }).catch(() => ifaces);
    }

    // a renamed connection (Vista keeps the name on the computer; here in this browser, per adapter)
    const NAMES_KEY = 'dreamos.ncpa.names';
    function customNames() {
        try {
            const v = JSON.parse(root.localStorage.getItem(NAMES_KEY) || '{}');
            return v && typeof v === 'object' ? v : {};
        } catch (_) { return {}; }
    }
    function storeName(iface, name) {
        const m = customNames();
        if (name) m[iface] = name; else delete m[iface];
        try { root.localStorage.setItem(NAMES_KEY, JSON.stringify(m)); } catch (_) { /* private window: the name lasts for the page */ }
    }

    // (#952) Local Area Connection numbers, kept in the order this computer first saw each adapter (Vista numbers them
    // as they are installed): adapter id -> n
    const LAN_ORDER_KEY = 'dreamos.ncpa.lanorder';
    function lanNumber(id) {
        let m = {};
        try { m = JSON.parse(root.localStorage.getItem(LAN_ORDER_KEY) || '{}') || {}; } catch (_) { m = {}; }
        if (!m[id]) {
            m[id] = Math.max(0, ...Object.values(m).map(Number).filter(Number.isFinite)) + 1;
            try { root.localStorage.setItem(LAN_ORDER_KEY, JSON.stringify(m)); } catch (_) { /* private window */ }
        }
        return m[id];
    }
    // the app's kinds (interfaces() v2) that Network Connections shows as a Local Area Connection: the modem's interfaces
    // in LAN mode (Vista / 7 show a phone's or a card's modem so; VZAccess Manager has its carrier and signal), the IP
    // accelerator, cables, tethering, Bluetooth PAN
    const LAN_KINDS = new Set(['ethernet', 'lan', 'mobile', 'ipa', 'usb', 'bluetooth', 'other', 'miniport']);

    /** The adapters, in Vista's order: { iface, kind: 'wifi' | 'ethernet' | 'mobile', label, mac, enabled, conn, base }. */
    function adapters() {
        const s = state();
        const w = s.wifi || {};
        let list;
        if (ifaces && ifaces.some((x) => x && x.nc !== undefined)) {
            // the app's v2 list (#952): every interface Network Connections shows, by its kernel name, with its
            // Windows-style device name; tun VPNs go to the VPN group, the rest are Local Area Connections
            const names = customNames();
            let wifis = 0;
            const phantom = (x) => x.present === false && x.kind === 'mobile' && x.name === 'rmnet0' && x.alias === 'rmnet0';
            const labels = uniqueLabels(ifaces.filter((x) => !phantom(x)));
            // (an app build before DSApp 9f5427c names a data interface it never saw "rmnet0", not present: no such
            // adapter exists, so it is not listed)
            return ifaces.filter((x) => x.nc && !phantom(x)).map((x) => {
                const id = String(x.alias || x.name);
                const a = { iface: String(x.name), id, kind: x.kind, label: labels.get(x) || x.label || '', mac: x.mac || '', enabled: x.enabled !== false, row: x, present: x.present !== false };
                let base;
                if (x.kind === 'wifi') { wifis += 1; base = wifis > 1 ? `${ADAPTER} ${wifis}` : ADAPTER; } else if (x.kind === 'vpn') base = x.vpnSession || x.vpnApp || 'VPN Connection'; // the tunnel's own name in its app (WireGuard's)
                else { const k = lanNumber(id); base = k > 1 ? `${LAN} ${k}` : LAN; }
                return { ...a, base, conn: names[id] || base };
            }).concat(miniportAdapter() ? [miniportAdapter()] : []);
        }
        if (ifaces) {
            // iface: the kernel name the app reads (rmnet_data1 changes between connections); id: the stable key
            // (the app's alias wlan0 / rmnet0) for renamed connections, open sheets and the selection (#945)
            list = ifaces.map((x) => ({ iface: String(x.name), id: String(x.alias || x.name), kind: x.kind, label: x.label || '', mac: x.mac || '', enabled: x.enabled !== false }));
        } else {
            list = [];
            if (host() && w.present) list.push({ iface: w.device || 'wlan0', id: w.device || 'wlan0', kind: 'wifi', label: '', mac: w.mac || '', enabled: w.radio !== false });
            (Array.isArray(s.ethernet) ? s.ethernet : []).forEach((e, i) => {
                if (e) list.push({ iface: e.name || `eth${i}`, id: e.name || `eth${i}`, kind: 'ethernet', label: '', mac: e.mac || '', enabled: e.state !== 'disabled' });
            });
            if (s.mobile && s.mobile.present) list.push({ iface: 'mobile', id: 'rmnet0', kind: 'mobile', label: '', mac: '', enabled: s.mobile.on !== false });
        }
        const names = customNames();
        let lans = 0;
        return list.filter((a) => a.kind === 'wifi' || a.kind === 'ethernet' || a.kind === 'mobile').map((a) => {
            let base = ADAPTER;
            if (a.kind === 'ethernet') { lans += 1; base = lans > 1 ? `${LAN} ${lans}` : LAN; }
            if (a.kind === 'mobile') base = MOBILE;
            return { ...a, base, conn: names[a.id] || base };
        }).concat(miniportAdapter() ? [miniportAdapter()] : []);
    }

    /** Device names as Device Manager / Network Connections show them: a second adapter with the same description is
     *  "<name> #2", a third "#3" (Windows numbers its instances; the app's names carry the kernel's number already, so
     *  this only parts two the app named alike). */
    function uniqueLabels(rows) {
        const out = new Map();
        const seen = new Map();
        rows.forEach((x) => {
            const base = String((x && x.label) || '');
            if (!base) return;
            const n = (seen.get(base) || 0) + 1;
            seen.set(base, n);
            out.set(x, n > 1 ? `${base} #${n}` : base);
        });
        return out;
    }

    /** The Nightshade adapter's lease from the server (melatonNetworkDialogs: 172.18.x.x, #952), or null. */
    function nightshadeLease() {
        const d = root.melatonNetworkDialogs;
        try { return d && typeof d.nightshadeLease === 'function' ? d.nightshadeLease() : null; } catch (_) { return null; }
    }

    /** The Café Miniport: the Nightshade app's virtual Ethernet adapter (#952), while this page rides on it. */
    function miniportAdapter() {
        const d = root.melatonNetworkDialogs;
        let info = null;
        try { info = d && typeof d.connectionInfo === 'function' ? d.connectionInfo() : null; } catch (_) { info = null; }
        if (!info || !info.viaMiniport) return null;
        const names = customNames();
        const lease = nightshadeLease();
        return { iface: 'miniport', id: 'miniport', kind: 'miniport', label: info.miniport || 'Xyridian Nightshade Virtual Ethernet Adapter', mac: lease ? lease.nic : '', enabled: true, present: true, base: info.connectionName, conn: names.miniport || info.connectionName };
    }

    const wifiAdapter = () => adapters().find((a) => a.kind === 'wifi') || { iface: '', id: 'wlan0', kind: 'wifi', label: '', mac: '', enabled: true, base: ADAPTER, conn: ADAPTER };

    /** The provider's interfaces() row of an adapter (the app reads the real interfaces, #945), or null. */
    const ifaceRow = (a) => (ifaces && ifaces.find((x) => String(x.name) === a.iface || (a.id && String(x.alias || '') === a.id))) || null;
    const rowList = (row, k) => (row && Array.isArray(row[k]) ? row[k] : []);

    /** An adapter's live facts from the provider's state. */
    function adapterInfo(a) {
        const s = state();
        if (a.kind === 'miniport') {
            const f = vpnFacts();
            const lease = f.connected ? nightshadeLease() : null;
            return { enabled: true, carrier: f.connected, connected: f.connected, network: f.domain || f.name, ip: lease ? [`${lease.ip}/${lease.prefix || 16}`] : [], ip6: [], mac: lease ? lease.nic : '', speedMbps: f.speedKbps ? f.speedKbps / 1000 : null, config: null, net: null, vpn: f, intranet: true, limited: !!f.limited, lease };
        }
        // the app's v2 rows (#952): a Local Area Connection or a VPN tunnel, from the interface itself
        if (a.row && a.kind !== 'wifi') {
            const r = a.row;
            const m = s.mobile || {};
            // (#952) the network's name, as Vista's status line shows it: the cellular data link is the carrier's network
            // (Windows 7 names a mobile broadband network after its provider); a modem link that is not the phone's data
            // (the carrier's IMS, a tethering PDN) has no Internet and no gateway Windows could name: Unidentified network
            const data = r.alias === 'rmnet0';
            const name = r.kind === 'vpn' ? (r.vpnSession || r.vpnApp || 'VPN') : r.kind === 'mobile' ? (data ? (m.carrier || r.apn || N.network) : 'Unidentified network') : (r.apn || N.network);
            return { enabled: a.enabled, present: r.present !== false, carrier: r.present !== false && !!r.up, connected: !!r.connected, network: name, ip: rowList(r, 'ip'), ip6: rowList(r, 'ip6'), mac: r.mac || '', speedMbps: null, config: null, net: null, connectedAt: Number(r.connectedAt) || 0, row: r, vpnTunnel: r.kind === 'vpn', dataLink: data || r.kind === 'ethernet' || r.kind === 'lan' || r.kind === 'usb' || r.kind === 'bluetooth' };
        }
        if (a.kind === 'wifi') {
            const w = s.wifi || {};
            const n = current();
            const enabled = a.enabled && w.radio !== false && w.state !== 'off';
            const row = ifaceRow(a);
            const ip = Array.isArray(w.ip) && w.ip.length ? w.ip : rowList(row, 'ip');
            return { enabled, carrier: !!n, connected: enabled && !!n, network: n ? String(n.name) : '', ip, ip6: w.ip6 && w.ip6.length ? w.ip6 : rowList(row, 'ip6'), mac: w.mac || a.mac, speedMbps: n ? (n.speedMbps !== undefined ? n.speedMbps : w.speedMbps) : null, config: w.config || null, net: n };
        }
        if (a.kind === 'ethernet') {
            const e = (Array.isArray(s.ethernet) ? s.ethernet : []).find((x) => x && x.name === a.iface) || {};
            const ip = Array.isArray(e.ip) ? e.ip : [];
            return { enabled: a.enabled, carrier: e.carrier === true, connected: a.enabled && e.carrier === true && ip.length > 0, network: N.network, ip, ip6: e.ip6 || [], mac: e.mac || a.mac, speedMbps: e.speedMbps, config: e.config || null, net: null };
        }
        if (a.kind === 'vpn') {
            const f = vpnFacts();
            return { enabled: true, carrier: f.connected, connected: f.connected, network: f.name, ip: [], ip6: [], mac: '', speedMbps: null, config: null, net: null, vpn: f };
        }
        const m = s.mobile || {};
        const on = a.enabled && m.on !== false;
        // the carrier's signal is there with data on or off (the radio is up); data flows only when connected
        const row = ifaceRow(a);
        return { enabled: on, carrier: !!m.connected, connected: on && !!m.connected, network: m.carrier || '', ip: rowList(row, 'ip'), ip6: rowList(row, 'ip6'), mac: (row && row.mac) || '', speedMbps: null, config: null, net: null, mobile: m };
    }

    /** The Nightshade / Café Miniport link (melatonControlPanel.connectionFacts), as a VPN adapter's facts. */
    function vpnFacts() {
        const cp = root.melatonControlPanel;
        let f = null;
        try { f = cp && typeof cp.connectionFacts === 'function' ? cp.connectionFacts() : null; } catch (_) { f = null; }
        if (f) return f;
        const ns = nightshade();
        return { state: ns.connected ? 'connected' : 'disconnected', connected: ns.connected, name: ns.name, domain: '', server: (root.location && root.location.hostname) || '', device: '', encryption: '', latency: '', connectedAt: 0, bytesIn: 0, bytesOut: 0, messagesIn: 0, messagesOut: 0 };
    }

    /** The VPN connection as an adapter for the status sheet (Network Connections' third group). */
    const vpnAdapter = () => ({ iface: 'vpn', id: 'vpn', kind: 'vpn', label: '', mac: '', enabled: true, base: vpnFacts().name, conn: vpnFacts().name });

    /** A mobile link's provider line: the carrier with its data class (5G, LTE), and Roaming. */
    function providerText(m) {
        if (!m || !m.carrier) return '';
        const gen = m.generation ? ` ${m.generation}` : '';
        return `${m.carrier}${gen}${m.roaming ? ' (Roaming)' : ''}`;
    }

    /** Network Connections' status line for an adapter (netshell 1039-1056). */
    function adapterStatus(a, info) {
        if (!info.enabled) return N.disabled;
        // (#952) a remembered adapter that is not there now, or one with no link: Vista's "Network cable unplugged"
        if (a.row && a.kind !== 'wifi') {
            if (a.kind === 'vpn') return info.connected ? N.connected : N.disconnectedVpn;
            if (info.present === false || !info.carrier) return N.unplugged;
            return info.connected ? info.network : 'Unidentified network';
        }
        if (a.kind === 'miniport') return info.connected ? (info.limited ? N.limited : info.network) : N.unplugged;
        if (a.kind === 'ethernet') {
            if (!info.carrier) return N.unplugged;
            return info.ip.length ? N.network : N.limited;
        }
        return info.connected ? info.network : N.notConnected;
    }

    /** The tile picture: netshell's two screens (118, grey 117 when disabled) under the adapter's mark (107 cable,
     *  115 wireless bars, 110 broadband, 108 the VPN's server) and 122's red cross when nothing is connected. */
    function connPicture(kind, look) {
        // (#952) the modem in LAN mode, the IP accelerator and the Café Miniport are Local Area Connections: the cable
        const mark = { wifi: 'ncpa-wireless-48', vpn: 'ncpa-vpn-48' }[kind] || 'ncpa-lan-48';
        return `<span class="dwf-nc-pic">${img(look === 'off' ? 'ncpa-pc-off-48' : 'ncpa-pc-48')}${img(mark)}${look === 'x' ? img('ncpa-x-48') : ''}</span>`;
    }

    /** Turn an adapter on or off: provider.enable(iface, on), for Wi-Fi radio(on) (the contract's own mapping). */
    async function setEnabled(a, on) {
        // the Café Miniport's Enable / Disable is the Nightshade connection itself (#952)
        if (a && a.kind === 'miniport') {
            const cp = root.melatonControlPanel;
            const f = vpnFacts();
            if (cp && typeof cp.toggleConnection === 'function' && (!!on !== !!f.connected)) cp.toggleConnection();
            root.setTimeout(ncRerender, 50);
            return;
        }
        const h = host();
        if (!h) return;
        let r = null;
        if (typeof h.enable === 'function' && can('enable')) r = await Promise.resolve(h.enable(a.iface, on)).catch((e) => ({ error: String(e) }));
        else if (a.kind === 'wifi' && can('radio')) r = await Promise.resolve(h.radio(on)).catch((e) => ({ error: String(e) }));
        else return;
        if (r && r.error) await message(on ? r.error : `${N.disableFail}`, on ? a.conn : N.disableTitle, 'error');
        await readIfaces();
        ncRerender();
    }

    const canSwitch = (a) => (!!a && a.kind === 'miniport') || (can('enable') || (a.kind === 'wifi' && can('radio')));

    // ---- an adapter's Properties (netshell 16004 "Networking") and TCP/IPv4 Properties (tcpipcfg 2323 / 2334) -------

    // the items Vista lists that Melaton's adapters have; descriptions: tcpipcfg 50002 / 50001
    // a connection's items, in the VM's order with their class pictures (SetupDiLoadClassIcon: NetClient, NetService,
    // NetTrans) and descriptions read off the VM (#952); core: no Uninstall (TCP/IP), props: has its own dialog here
    const ITEMS = [
        { id: 'client', icon: 'class-netclient-16', name: 'Client for Microsoft Networks', text: 'Allows your computer to access resources on a Microsoft network.' },
        { id: 'qos', icon: 'class-netservice-16', name: 'QoS Packet Scheduler', text: 'Quality of Service Packet Scheduler.  This component provides network traffic control, including rate-of-flow and prioritization services.' },
        { id: 'share', icon: 'class-netservice-16', name: 'File and Printer Sharing for Microsoft Networks', text: 'Allows other computers to access resources on your computer using a Microsoft network.' },
        { id: 'ipv6', icon: 'class-nettrans-16', core: true, name: 'Internet Protocol Version 6 (TCP/IPv6)', text: 'TCP/IP version 6. The latest version of the internet protocol that provides communication across diverse interconnected networks.' },
        { id: 'ipv4', icon: 'class-nettrans-16', core: true, props: true, name: 'Internet Protocol Version 4 (TCP/IPv4)', text: 'Transmission Control Protocol/Internet Protocol. The default wide area network protocol that provides communication across diverse interconnected networks.' },
        { id: 'lltdio', icon: 'class-nettrans-16', name: 'Link-Layer Topology Discovery Mapper I/O Driver', text: 'Used to discover and locate other PCs, devices, and network infrastructure components on the network.  Also used to determine network bandwidth.' },
        { id: 'rspndr', icon: 'class-nettrans-16', name: 'Link-Layer Topology Discovery Responder', text: 'Allows this PC to be discovered and located on the network.' }
    ];
    // Install...'s feature types (netshell 16001)
    const FEATURES = [
        { id: 'client', icon: 'class-netclient-16', name: 'Client', text: 'A client provides access to computers and files on the network you are connecting to.' },
        { id: 'service', icon: 'class-netservice-16', name: 'Service', text: 'A service provides additional features such as file and printer sharing.' },
        { id: 'protocol', icon: 'class-nettrans-16', name: 'Protocol', text: 'A protocol is a language your computer uses to communicate with other computers.' }
    ];

    // the status sheet's caption: the connection's own icon (#952: the house was the network location, not the adapter;
    // a cable connection, the modem in LAN mode and the Café Miniport show netshell's LAN connection, a tunnel the VPN's)
    const adapterIcon = (a) => (a && a.kind === 'wifi' ? `${NET}/netshell-wireless-16.png` : a && a.kind === 'vpn' ? `${NET}/ncpa-vpn-16.png` : `${NET}/ncpa-lan-16.png`);

    /** A list view of [{ id, icon, name }] rows with ticked boxes (the binding is the system's: a click selects the row,
     *  the tick stays), the first selected; onPick(row id) on a selection. */
    function itemList(lv, rows, onPick, boxes = true) {
        const body = lv && lv.querySelector('.vdt-lv-body');
        if (!body) return;
        body.innerHTML = rows.map((it, i) => `<div class="vdt-lv-row dwf-item${i === 0 ? ' is-selected' : ''}" data-value="${esc(it.id)}">`
            + `${boxes ? '<input type="checkbox" checked tabindex="-1">' : ''}${img(it.icon, 'dwf-item-icon')}<span>${esc(it.name)}</span></div>`).join('');
        body.querySelectorAll('input[type=checkbox]').forEach((b) => b.addEventListener('click', (ev) => ev.preventDefault()));
        const pick = (row) => {
            body.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
            row.classList.add('is-selected');
            onPick(row.dataset.value);
        };
        body.addEventListener('click', (ev) => { const row = ev.target.closest('.vdt-lv-row'); if (row) pick(row); });
        lv.addEventListener('keydown', (ev) => {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
            ev.preventDefault();
            const cur = body.querySelector('.is-selected');
            const next = cur && (ev.key === 'ArrowDown' ? cur.nextElementSibling : cur.previousElementSibling);
            if (next) pick(next);
        });
        if (body.firstElementChild) onPick(body.firstElementChild.dataset.value);
    }

    /** Install... (netshell 16001 Select Network Feature Type): Client, Service, Protocol. Melaton's network features
     *  are the system's own, so Add... says there are none to add. */
    async function installFeature(owner) {
        const V = await kit();
        const k = 'netshell:16001';
        V.openDialog({
            id: 'dreamosNetFeatureType',
            key: k,
            owner,
            bareCaption: true,
            buttons: {
                15009: () => { void message('There are no other network features to install. The ones this computer has are part of Melaton.', 'Select Network Feature Type', 'info'); }
            },
            init: (c) => itemList(c.holder(15006), FEATURES, (id) => { const f = FEATURES.find((x) => x.id === id); c.text(15019, f ? f.text : ''); }, false)
        });
    }

    async function adapterProperties(owner, a) {
        const V = await kit();
        const ad = a || wifiAdapter();
        const k = 'netshell:16004';
        const H = 'netshell:10751';
        // Sharing (Internet Connection Sharing) is there when another connection could share this one, as on Vista
        const others = adapters().filter((x) => x !== ad && (x.id || x.iface) !== (ad.id || ad.iface) && x.kind !== 'vpn');
        const pages = [{ key: k, overrides: { 16006: { image: `${NET}/class-net-16.png` } } }];
        // (netshell 10751 as Vista lays it out with a home network to pick: the taller group, Home networking connection and
        // its list under the first box, the rest moved down past them)
        if (others.length) pages.push({ key: H, overrides: { 103: { skip: true }, 115: { skip: true }, 108: { skip: true }, 105: { disabled: true }, 106: { disabled: true }, 107: { disabled: true }, 109: { disabled: true, nudge: [0, 32, 0, 0] }, 110: { nudge: [0, 32, 0, 0] }, 111: { nudge: [0, 32, 0, 0] }, 112: { disabled: true, nudge: [0, 32, 0, 0] } } });
        V.openSheet({
            id: 'dreamosAdapterProps',
            title: fill(N.props, ad.conn),
            icon: adapterIcon(ad),
            captionIcon: true, // the connection's icon in the caption, as on the VM
            owner,
            noApply: true,
            pages,
            init: (c) => {
                c.set(15003, ad.label || (ad.kind === 'wifi' ? (state().wifi || {}).device : '') || ad.iface || ad.conn, k);
                c.show(16006, true, k);
                // GDI fits "Connect using:" in its 48 DLU; the browser's Tahoma is a little wider: keep it on one line
                c.content.querySelectorAll('.vdt-static').forEach((st) => { if (/^Connect using:/.test(st.textContent)) st.classList.add('vdt-nowrap'); });
                let sel = ITEMS[0];
                itemList(c.holder(15007, k), ITEMS, (id) => {
                    sel = ITEMS.find((x) => x.id === id) || ITEMS[0];
                    c.text(15020, sel.text, k);
                    c.enable(15012, !sel.core, k);
                    c.enable(15011, !!sel.props, k);
                });
                const lv = c.holder(15007, k);
                if (lv) lv.addEventListener('dblclick', (ev) => { const row = ev.target.closest('.vdt-lv-row'); if (row && row.dataset.value === 'ipv4') void ipv4Properties(ad, c.modal); });
                c.on(15011, 'click', () => { if (sel.props) void ipv4Properties(ad, c.modal); }, k);
                // Configure...: the adapter's own sheet in Device Manager (cplDeviceManager openAdapter)
                const dm = root.melatonDeviceManager;
                c.enable(15031, !!(dm && typeof dm.openAdapter === 'function'), k);
                c.on(15031, 'click', () => {
                    const m = root.melatonDeviceManager;
                    if (m && typeof m.openAdapter === 'function') void Promise.resolve(m.openAdapter(ad.kind === 'miniport' ? 'miniport' : ad.iface)).then((ok) => { if (!ok) void message(`${ad.label || ad.conn} is not in Device Manager.`, fill(N.props, ad.conn), 'info'); });
                }, k);
                c.on(15008, 'click', () => { void installFeature(c.modal); }, k);
                c.on(15012, 'click', async () => {
                    const yes = await ask(`Uninstalling a component removes it from all network connections.\n\nAre you sure you want to uninstall ${sel.name}?`, fill(N.props, ad.conn), 'warning');
                    if (yes) void message(`${sel.name} cannot be uninstalled: it is part of Melaton's network.`, fill(N.props, ad.conn), 'info');
                }, k);
                if (others.length) {
                    [104, 106, 107].forEach((id) => c.show(id, true, H));
                    c.options(107, others.map((x) => x.conn), others[0].conn, H);
                    c.set(109, true, H);
                    c.on(111, 'click', () => call('openHelpAndSupport', 'internet-connection-sharing'), H);
                }
            }
        });
    }

    // TCP/IPv4 Properties' words (tcpipcfg.dll.mui); its message boxes are captioned "Microsoft TCP/IP" (23001)
    const T4 = {
        title: 'Internet Protocol Version 4 (TCP/IPv4) Properties',
        caption: 'Xyridian TCP/IP',
        needIp: 'The adapter requires at least one IP address.  Please enter one.', // 23003
        needMask: 'You have entered an address that is missing its subnet mask.  Please add a subnet mask', // 23004
        loopback: 'IP addresses starting with %1 are not valid because they are reserved for loopback addresses. Please specify some other valid value between %2 and %3.', // 23006
        firstField: '%1 is not a valid entry as the first field of a host IP address. Please specify a value between %2 and %3.', // 23007
        maskGap: 'You entered an invalid subnet mask. The subnet mask has to be contiguous. Please enter a valid mask.', // 23066
        sameDns: 'The alternate DNS server cannot be the same as the preferred DNS server. Please enter a different IP address for the alternate DNS server.', // 23083
        hostOnes: 'The combination of IP address and subnet mask is invalid. All of the bits in the host address portion of the IP address are set to 1. Please enter a valid combination of IP address and subnet mask.', // 23084
        hostZeros: 'The combination of IP address and subnet mask is invalid. All of the bits in the host address portion of the IP address are set to 0. Please enter a valid combination of IP address and subnet mask.', // 23085
        netZeros: 'The combination of IP address and subnet mask is invalid. All of the bits in the network address portion of the IP address are set to 0. Please enter a valid combination of IP address and subnet mask.', // 23086
        gwSubnet: 'Warning - The default gateway is not on the same network segment (subnet) that is defined by the IP address and subnet mask. Do you want to save this configuration?' // 23089
    };
    const fill3 = (text, a, b, c) => String(text).replace('%1', a).replace('%2', b).replace('%3', c);

    const ipNum = (s) => String(s).split('.').reduce((n, p) => (n * 256) + (Number(p) || 0), 0);
    const ipStr = (n) => [24, 16, 8, 0].map((sh) => Math.floor(n / (2 ** sh)) % 256).join('.');
    const maskOf = (prefix) => ipStr(prefix > 0 ? (2 ** 32) - (2 ** (32 - Math.min(32, prefix))) : 0);
    /** A dotted mask's prefix length, or -1 when its bits are not contiguous. */
    function prefixOf(mask) {
        const n = ipNum(mask);
        for (let p = 0; p <= 32; p += 1) if (ipNum(maskOf(p)) === n) return p;
        return -1;
    }
    /** "192.168.1.20/24" or a bare address: { address, prefix } */
    function splitCidr(v) {
        const m = /^(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?$/.exec(String(v || '').trim());
        return m ? { address: m[1], prefix: m[2] !== undefined ? Number(m[2]) : null } : { address: '', prefix: null };
    }
    /** The natural (classful) mask Vista fills in for an address: A 255.0.0.0, B 255.255.0.0, C 255.255.255.0. */
    function classMask(ip) {
        const f = Number(String(ip).split('.')[0]);
        if (!f) return '';
        return f < 128 ? '255.0.0.0' : f < 192 ? '255.255.0.0' : '255.255.255.0';
    }

    function ask(text, title, icon) {
        return Promise.resolve(call('showConfirmationDialog', esc(text).replace(/\n/g, '<br>'),
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null,
            { title, icon: icon === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-question-circle', sound: true })).then((v) => v === true);
    }

    /**
     * Advanced TCP/IP Settings (tcpipcfg 2308 IP Settings, 2322 DNS, 2324 WINS), filled as the VM fills them (#952): a
     * DHCP connection lists "DHCP Enabled" and no static gateway or DNS server (they come from the DHCP server), a
     * connection with fixed addresses (the modem's links, a static setting) lists them with their masks, gateway
     * (metric Automatic) and DNS servers; DNS suffix for this connection is the static one (none). The lists show what
     * the host has; what Melaton cannot set from here (WINS, LMHOSTS, metrics) is shown and greyed.
     */
    async function ipv4Advanced(a, owner) {
        const V = await kit();
        const IP = 'tcpipcfg:2308';
        const D = 'tcpipcfg:2322';
        const W = 'tcpipcfg:2324';
        const info = adapterInfo(a);
        const cfg = info.config && typeof info.config === 'object' ? info.config : null;
        const st = statusWins.get(a.id || a.iface) || { a, stats: null };
        const x = (await readStats(st)) || {};
        const r = a.row || {};
        const dhcp = a.kind === 'miniport' ? true : x.dhcp !== undefined ? !!x.dhcp : r.dhcp !== undefined ? !!r.dhcp : (a.kind === 'mobile' || a.kind === 'ipa') ? false : !(cfg && cfg.mode === 'static');
        const v4 = ((Array.isArray(x.ip) && x.ip.length ? x.ip : info.ip) || []).map(splitCidr).filter((p) => p.address);
        const gw = x.gateway || r.gateway || (cfg && cfg.gateway) || '';
        const dnsList = (Array.isArray(x.dns) && x.dns.length ? x.dns : Array.isArray(r.dns) ? r.dns : (cfg && cfg.dns) || []).filter((d) => !String(d).includes(':'));
        const table = (lv, cols, rows) => {
            const head = lv && lv.querySelector('.vdt-lv-header');
            const body = lv && lv.querySelector('.vdt-lv-body');
            if (!body) return;
            if (head) head.innerHTML = cols.map(([t, w]) => `<span class="vdt-lv-col" style="width:${w}px">${esc(t)}</span>`).join('');
            body.innerHTML = rows.map((row) => `<div class="vdt-lv-row">${row.map((v, i) => `<span style="width:${cols[i][1]}px">${esc(v)}</span>`).join('')}</div>`).join('');
        };
        const listBox = (lb, rows) => {
            const e = lb && (lb.classList.contains('vdt-listbox') ? lb : lb.querySelector('.vdt-listbox'));
            if (e) e.innerHTML = rows.map((v) => `<div class="vdt-lb-row" data-value="${esc(v)}" role="option"><span>${esc(v)}</span></div>`).join('');
        };
        // the order buttons are BS_ICON: tcpipcfg's green arrows, no label
        const arrows = (up, down) => ({ [up]: { image: '/static_images/vista-dlg/tcpipcfg-up-16.png', text: '', disabled: true }, [down]: { image: '/static_images/vista-dlg/tcpipcfg-down-16.png', text: '', disabled: true } });
        const off = (ids) => Object.fromEntries(ids.map((id) => [id, { disabled: true }]));
        V.openSheet({
            id: 'dreamosIpv4Advanced',
            title: 'Advanced TCP/IP Settings',
            owner,
            bareCaption: true,
            help: true,
            noApply: true,
            pages: [
                { key: IP, overrides: off([1017, 1018, 1019, 1020, 1021, 1022, 1030, 1073, 1029]) },
                { key: D, overrides: { ...off([1041, 1042, 1043, 1046, 1047, 1048, 1050, 1051, 1052, 1057, 1058, 1032]), ...arrows(1044, 1045), ...arrows(1053, 1054), 1031: { html: '<input type="text" class="tbp-ctl tbp-edit vdt-edit dwf-dns-suffix" disabled>', cls: 'dwf-netaddress' } } },
                { key: W, overrides: { ...off([1061, 1062, 1063, 1066, 1067, 1070, 1068, 1069, 1074]), ...arrows(1064, 1065) } }
            ],
            init: (c) => {
                table(c.holder(1016, IP), [['IP address', 165], ['Subnet mask', 160]], dhcp ? [['DHCP Enabled', '']] : v4.map((p) => [p.address, p.prefix !== null ? maskOf(p.prefix) : '']));
                table(c.holder(1004, IP), [['Gateway', 165], ['Metric', 160]], !dhcp && gw ? [[gw, 'Automatic']] : []);
                c.set(1030, true, IP);
                listBox(c.holder(1040, D), dhcp ? [] : dnsList);
                c.set(1046, true, D);
                c.set(1047, true, D);
                c.set(1057, true, D);
                c.set(1058, false, D);
                listBox(c.holder(1060, W), []);
                c.set(1066, true, W);
                c.set(1070, true, W);
            }
        });
    }

    async function ipv4Properties(a, owner) {
        const V = await kit();
        const G = 'tcpipcfg:2323';
        const A = 'tcpipcfg:2334';
        const info = adapterInfo(a);
        const cfg = info.config && typeof info.config === 'object' ? info.config : null;
        const fixed = cfg && cfg.mode === 'static' ? cfg : null;
        const dns = cfg && Array.isArray(cfg.dns) ? cfg.dns : [];
        const allowed = can('ipConfig');
        const sync = (c) => {
            const isStatic = !!c.get(1001, G);
            [1005, 1006, 1007, 1002, 1003, 1004].forEach((id) => c.enable(id, allowed && isStatic, G));
            // a fixed address needs fixed DNS servers: Obtain DNS automatically greys out, as on the VM
            if (isStatic) c.set(1010, true, G);
            c.enable(1009, allowed && !isStatic, G);
            if (!isStatic && !c.get(1010, G)) c.set(1009, true, G);
            const dnsStatic = !!c.get(1010, G);
            [1013, 1014, 1011, 1012].forEach((id) => c.enable(id, allowed && dnsStatic, G));
            // the Alternate Configuration tab is there only while the address comes from DHCP
            const tab = c.content.querySelector(`.tbp-tab[data-vdt-tab="${A}"]`);
            if (tab) tab.hidden = isStatic;
        };
        V.openSheet({
            id: 'dreamosIpv4Props',
            title: T4.title,
            icon: adapterIcon(a),
            owner,
            bareCaption: true,
            help: true,
            noApply: true,
            pages: [
                { key: G },
                // Automatic private IP address only: the host keeps no user-configured alternate
                { key: A, overrides: { 1071: { disabled: true }, 1072: { disabled: true }, 1073: { disabled: true }, 1074: { disabled: true }, 1075: { disabled: true }, 1076: { disabled: true }, 1077: { disabled: true }, 1078: { disabled: true }, 1079: { disabled: true }, 1080: { disabled: true }, 1081: { disabled: true }, 1082: { disabled: true }, 1083: { disabled: true }, 1084: { disabled: true }, 1085: { disabled: true } } }
            ],
            init: (c) => {
                // the host address fields' first byte is 1-223 (tcpipcfg), the mask's 0-255
                [1002, 1004, 1011, 1012].forEach((id) => c.ipRange(id, 0, 1, 223, G));
                c.set(1000, !fixed, G);
                c.set(1001, !!fixed, G);
                if (fixed) {
                    c.set(1002, fixed.address || '', G);
                    c.set(1003, Number.isFinite(Number(fixed.prefix)) && fixed.prefix !== null ? maskOf(Number(fixed.prefix)) : '', G);
                    c.set(1004, fixed.gateway || '', G);
                }
                const fixedDns = !!fixed || dns.length > 0;
                c.set(1009, !fixedDns, G);
                c.set(1010, fixedDns, G);
                c.set(1011, dns[0] || '', G);
                c.set(1012, dns[1] || '', G);
                c.set(1070, true, A);
                c.enable(1070, allowed, A);
                [1000, 1001, 1009, 1010].forEach((id) => c.on(id, 'change', () => sync(c), G));
                // Advanced...: the connection's addresses, gateways, DNS and WINS as TCP/IP holds them (#952)
                c.on(1015, 'click', () => { void ipv4Advanced(a, c.modal); }, G);
                // the subnet mask fills itself in from the address's class when it gets the focus empty, as on the VM
                const mask = c.holder(1003, G);
                if (mask) {
                    mask.addEventListener('focusin', () => {
                        const ip = c.get(1002, G);
                        if (ip && !c.get(1003, G)) { c.set(1003, classMask(ip), G); c.dirty(); }
                    });
                }
                if (!allowed) [1000, 1001, 1008].forEach((id) => c.enable(id, false, G));
                sync(c);
            },
            apply: async (c) => {
                const h = host();
                if (!allowed || !h) return true;
                const isStatic = !!c.get(1001, G);
                const dnsStatic = !!c.get(1010, G);
                const say = (text, field) => message(text, T4.caption, 'error').then(() => { if (field) c.ipFocus(field, 0, G); return false; });
                const next = { mode: isStatic ? 'static' : 'dhcp' };
                if (isStatic) {
                    const ip = c.get(1002, G);
                    const mk = c.get(1003, G);
                    const gw = c.get(1004, G);
                    if (!ip) return say(T4.needIp, 1002);
                    if (!mk) return say(T4.needMask, 1003);
                    const prefix = prefixOf(mk);
                    if (prefix < 0) return say(T4.maskGap, 1003);
                    const first = Number(ip.split('.')[0]);
                    if (first === 127) return say(fill3(T4.loopback, '127', '1', '223'), 1002);
                    if (first < 1 || first > 223) return say(fill3(T4.firstField, String(first), '1', '223'), 1002);
                    const n = ipNum(ip);
                    const m = ipNum(mk);
                    const size = (2 ** 32) - m;
                    const hostPart = n % size;
                    if (prefix < 31 && hostPart === size - 1) return say(T4.hostOnes, 1002);
                    if (prefix < 31 && hostPart === 0) return say(T4.hostZeros, 1002);
                    if (n - hostPart === 0) return say(T4.netZeros, 1002);
                    if (gw && ipNum(gw) - (ipNum(gw) % size) !== n - hostPart && !(await ask(T4.gwSubnet, T4.caption, 'warning'))) return false;
                    next.address = ip;
                    next.prefix = prefix;
                    next.gateway = gw || '';
                }
                if (dnsStatic) {
                    const pref = c.get(1011, G);
                    const alt = c.get(1012, G);
                    if (alt && alt === pref) return say(T4.sameDns, 1012);
                    next.dns = [pref, alt].filter(Boolean);
                } else if (isStatic) next.dns = [];
                const r = await Promise.resolve(h.ipConfig(a.iface, next)).catch((e) => ({ error: String((e && e.message) || e) }));
                if (r && r.error) { await message(r.error, T4.caption, 'error'); return false; }
                ncRerender();
                return true;
            }
        });
    }

    // ---- an adapter's Status: Wireless (netshell 24050) or Local Area Connection (23500), and Details (24300) ------

    const statusWins = new Map(); // iface -> { ctx, a, key, timer, stats, since }

    // The VPN sheet's Details tab: rasdlg's page (a Property / Value list over the General page's 227 x 215 DLU)
    // (#952) a VPN's status is Vista's own RAS sheet: netshell 24100 (General: Connection, Activity) and 24200 (Details:
    // the Property / Value list, Devices with the miniport, Number of active devices, Suspend)
    const VPN_GENERAL = 'netshell:24100';
    const VPN_DETAILS = 'netshell:24200';
    const VPN_DETAILS_LIST = 24205;

    /** The Café Miniport / Nightshade connection's status (Network Connections' VPN tile, the Center's View status). */
    // the Café Miniport's adapter when this page rides on it (#952), else the Nightshade link as a VPN connection
    function openVpnStatus() { return openStatus(miniportAdapter() || vpnAdapter()); }

    function duration(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        const d = Math.floor(t / 86400);
        const hms = `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        return d ? `${d}${d === 1 ? S.day : S.days}${hms}` : hms;
    }

    function bytes(n) {
        return Number.isFinite(Number(n)) && n !== null && n !== undefined ? Number(n).toLocaleString('en-US') : S.notAvailable;
    }

    function speed(mbps) {
        const v = Number(mbps);
        if (!Number.isFinite(v) || v <= 0 || mbps === null) return S.notAvailable;
        // netshell 23031 / 23032 / 23033: under a megabit the rate is in Kbps (a cellular link's first estimate), not "0.0 Mbps"
        if (v < 1) return `${(v * 1000).toFixed(1)} Kbps`;
        return v >= 1000 ? `${(v / 1000).toFixed(1)} Gbps` : `${v.toFixed(1)} Mbps`;
    }

    /** Internet behind the link: dreamosNetTray's one answer (sign-in page, the host's word, the server socket; the
     *  Android WebView's navigator.onLine is false on a working Wi-Fi and never decides it) */
    function reachesInternet() {
        const t = root.dreamosNetTray;
        if (t && typeof t.internet === 'function') return t.internet();
        const portal = root.dreamosPortal && typeof root.dreamosPortal.captive === 'function' && root.dreamosPortal.captive();
        return !portal && (!root.navigator || root.navigator.onLine !== false);
    }

    function internetWord() {
        return reachesInternet() ? S.internet : S.local;
    }

    function ipv4Text(info, x) {
        if (!info.connected && !(info.carrier && info.enabled)) return S.notConnected;
        const ip = (x && Array.isArray(x.ip) && x.ip.length ? x.ip : info.ip) || [];
        // (#952) a modem link that carries no IPv4 (the carrier's IMS is IPv6 only): IPv4 is not connected there
        if (info.row && !info.dataLink && !ip.length) return S.notConnected;
        // the app's v2 row of a link that is not the phone's Internet (IMS): Local at most
        if (info.row && !info.dataLink && info.row.kind !== 'vpn') return S.local;
        // a mobile data link or the VPN that is carrying this page reaches the Internet, address or not (an older app
        // does not say the cellular address)
        if (!ip.length && (info.mobile || info.vpn) && info.connected) return internetWord();
        if (!ip.length) return S.limited;
        return internetWord();
    }

    function ipv6Text(info, x) {
        const ip6 = (x && Array.isArray(x.ip6) && x.ip6.length ? x.ip6 : info.ip6) || [];
        if (!info.enabled || !info.carrier || !ip6.length) return S.notConnected;
        const global = ip6.some((a) => !/^fe80:/i.test(String(a)));
        // (#952) a global address on a link that is not the Internet's (the carrier's IMS) is Local, never Internet
        if (info.row && !info.dataLink && info.row.kind !== 'vpn') return S.local;
        return global && reachesInternet() ? S.internet : S.local;
    }

    // Windows writes a physical address as 00-0C-29-E8-4E-9F (a bare 12-digit one, the Nightshade adapter's, too)
    const macText = (m) => {
        const v = String(m || '');
        if (/^[0-9a-f]{12}$/i.test(v)) return v.toUpperCase().match(/../g).join('-');
        return v ? v.replace(/[:.]/g, '-').toUpperCase() : '';
    };

    function statusPaint(st) {
        if (!st || !st.ctx.modal.isConnected) return;
        const c = st.ctx;
        const k = st.key;
        const info = adapterInfo(st.a);
        const x = st.stats || {};
        const set = (id, text) => {
            const h = c.holder(id, k);
            const t = h && h.querySelector('.vdt-st-text');
            if (t) { if (t.textContent !== text) t.textContent = text; } else c.text(id, text, k);
        };
        const kind = st.a.kind;
        // the Café Miniport reaches the domain's intranet only (#952): Local, never Internet; Limited when its measured
        // rate is too low
        // (the Nightshade link as a VPN reaches the same intranet: Local too)
        const intranet = kind === 'miniport' || (kind === 'vpn' && !st.a.row);
        set(23502, intranet ? (info.connected ? (info.limited ? S.limited : S.local) : S.notConnected) : ipv4Text(info, x));
        set(23504, kind === 'vpn' || kind === 'miniport' ? S.notConnected : ipv6Text(info, x));
        set(1007, info.connected || (info.enabled && info.carrier) ? S.enabled : info.enabled ? S.disconnected : N.disabled);
        // the wireless sheet's SSID; the mobile one names the provider there (the carrier, its data class, Roaming)
        if (kind === 'wifi') set(24018, info.connected ? info.network : '');
        if (kind === 'mobile') set(24018, info.enabled ? providerText(info.mobile) : '');
        // Duration from when the host says the link came up (connectedAt), else from when this page saw it
        const n = info.net || {};
        // (#952) the link's real start (the app's record, the network agent's creation, the socket's open), never the
        // time this window opened
        const up = Number(x.connectedAt || n.connectedAt || info.connectedAt) || (kind === 'wifi' && info.connected ? connectedSince : 0);
        set(1008, info.connected && up ? duration(Date.now() - up) : '00:00:00');
        // Speed: the link's bit rate (stats, or the network's rx / tx rates), else the adapter's speed
        const kbps = Math.max(Number(x.rxBitrateKbps) || 0, Number(x.txBitrateKbps) || 0, Number(n.rxBitrateKbps) || 0, Number(n.txBitrateKbps) || 0);
        set(1009, (info.connected || info.carrier) && (kbps || info.speedMbps) ? speed(kbps ? kbps / 1000 : info.speedMbps) : S.notAvailable);
        // Activity: what this connection carried since it came up; nothing while it is down (not the device's totals)
        set(1003, info.connected ? bytes(x.txBytes) : '0');
        set(1005, info.connected ? bytes(x.rxBytes) : '0');
        if (kind === 'wifi' || kind === 'mobile') {
            const pct = kind === 'wifi' ? (info.connected ? n.signalPercent : 0) : (info.enabled && info.mobile ? info.mobile.signalPercent : 0);
            const lit = info.enabled && (kind === 'mobile' || info.connected);
            const meter = c.holder(1044, k);
            const im = meter && meter.querySelector('img');
            const src = `${NET}/tray-wifi-${lit ? signalLevel(pct) : 0}-32.png`; // pnidui.dll 13-18 (netshell's set is not used)
            if (im && im.getAttribute('src') !== src) {
                im.setAttribute('src', src);
                im.setAttribute('srcset', src.replace('.png', '@2x.png 2x'));
            }
            // no link, no meter
            const vis = lit ? '' : 'hidden';
            if (meter && meter.style.visibility !== vis) meter.style.visibility = vis;
        }
        if (kind === 'wifi') c.enable(24020, info.connected, k);
        if (kind === 'vpn' && st.a.row) {
            vpnDetailsPaint(st);
            return;
        }
        if (kind === 'vpn') {
            // Disconnect / Connect with its access key (ctx.text writes plain text)
            const btn = info.connected || (info.vpn && info.vpn.state === 'connecting') ? 'Dis<u>c</u>onnect' : 'C<u>o</u>nnect';
            const b = c.el(1025, k);
            if (b && st.vpnButton !== btn) { st.vpnButton = btn; b.innerHTML = btn; }
            vpnDetailsPaint(st);
            return;
        }
        c.enable(23506, info.connected || (info.enabled && info.carrier), k);
        c.enable(1025, canSwitch(st.a) && info.enabled, k);
    }

    /** The VPN sheet's Details tab: RAS's Property / Value list (rasdlg's Details page), redrawn on a change only. */
    function vpnDetailsPaint(st) {
        const f = vpnFacts();
        // a VPN app's tunnel (#952): what the interface and its app say
        const r = st.a.row;
        // rasdlg's Details (netshell's RAS strings, Vista's order): Device Name, Device Type, Server type, Transports,
        // Authentication, Encryption, Compression, PPP multilink framing, Server / Client IPv4 address (#952)
        const lease = nightshadeLease();
        const wg = /wireguard/i.test((r && r.vpnPackage) || '');
        const v4 = r ? (rowList(r, 'ip')[0] || '').split('/')[0] : '';
        const rows = r ? [
            ['Device Name', r.label || st.a.iface],
            ['Device Type', 'vpn'],
            ['Server type', wg ? 'WireGuard' : (r.vpnApp || 'VPN')],
            ['Transports', 'TCP/IP'],
            ['Authentication', wg ? 'Public key (Curve25519)' : ''],
            ['Encryption', wg ? 'ChaCha20-Poly1305' : ''],
            ['Compression', '(none)'],
            ['PPP multilink framing', 'Off'],
            ['Server IPv4 address', r.gateway || ''],
            ['Client IPv4 address', v4]
        ] : [
            ['Device Name', f.device],
            ['Device Type', 'vpn'],
            ['Server type', 'Xyridian Nightshade'],
            ['Transports', 'TCP/IP (WebSocket)'],
            ['Authentication', f.authentication || 'User Password'],
            ['Encryption', f.encryption],
            ['Compression', f.compression || '(none)'],
            ['PPP multilink framing', 'Off'],
            ['Server IPv4 address', lease && f.connected ? lease.gateway : ''],
            ['Client IPv4 address', lease && f.connected ? lease.ip : ''],
            ['Domain', f.domain],
            ['Server name', (lease && lease.domain) || f.server],
            ['Latency', f.latency || S.notAvailable],
            ['Messages sent', Number(f.messagesOut || 0).toLocaleString()],
            ['Messages received', Number(f.messagesIn || 0).toLocaleString()]
        ];
        const key = JSON.stringify(rows);
        if (key === st.detailsKey) return;
        st.detailsKey = key;
        const lv = st.ctx.holder(VPN_DETAILS_LIST, VPN_DETAILS);
        if (lv) fillPropertyList(lv, rows);
        // Devices: the connection's miniport, and how many of its devices are up (RAS's multilink count)
        const dev = rows[0] ? String(rows[0][1] || '') : '';
        st.ctx.options(24206, dev ? [dev] : [], dev, VPN_DETAILS);
        const up = r ? !!r.connected : !!f.connected;
        st.ctx.text(24204, up ? '1' : '0', VPN_DETAILS);
    }

    /** A Property / Value list (netshell's Details list, the VPN's Details tab). */
    function fillPropertyList(lv, rows) {
        const head = lv.querySelector('.vdt-lv-header');
        const body = lv.querySelector('.vdt-lv-body');
        if (!body) return;
        if (head && !head.childElementCount) {
            [['Property', 'dwf-col-prop'], ['Value', 'dwf-col-value']].forEach(([t, cls]) => {
                const col = doc.createElement('span');
                col.className = `vdt-lv-col ${cls}`;
                col.textContent = t;
                head.appendChild(col);
            });
        }
        body.textContent = '';
        rows.forEach(([p, v]) => {
            const row = doc.createElement('div');
            row.className = 'vdt-lv-row';
            const l = doc.createElement('span');
            l.className = 'dwf-col-prop';
            l.textContent = p;
            const r = doc.createElement('span');
            r.className = 'dwf-col-value';
            r.textContent = v == null ? '' : String(v);
            row.append(l, r);
            body.appendChild(row);
        });
        // (#952) the VM's list keeps each value whole: the Value column is as wide as its longest value (LVSCW_AUTOSIZE)
        // and the list scrolls sideways, its header with it; nothing is cut to "..."
        lv.classList.add('dwf-proplist');
        // (measured once the dialog is on the page: the kit fills it before it shows)
        const measure = (tries) => {
            const widest = Math.max(0, ...Array.from(body.querySelectorAll('.dwf-col-value'), (v) => v.scrollWidth));
            if (widest) lv.style.setProperty('--dwf-value-w', `${Math.ceil(widest) + 2}px`);
            else if (tries > 0) root.requestAnimationFrame(() => measure(tries - 1));
        };
        measure(10);
        if (head && !lv.dataset.dwfScroll) {
            lv.dataset.dwfScroll = '1';
            body.addEventListener('scroll', () => { head.scrollLeft = body.scrollLeft; }, { passive: true });
        }
    }

    /** The sheet is on screen: not closed, not minimised, the page shown and the screen on. */
    const statusSeen = (st) => !!(st && st.ctx.modal.isConnected && !st.ctx.modal.classList.contains('hidden') && !doc.hidden && doc.documentElement.dataset.screenOff === undefined);

    /** One read of the adapter's counters (provider.stats: never pushed, read when asked). */
    function readStats(st) {
        // the VPN: the page's own socket counts what the link carried
        if ((st.a.kind === 'vpn' && !st.a.row) || st.a.kind === 'miniport') {
            const f = vpnFacts();
            st.stats = { txBytes: f.bytesOut, rxBytes: f.bytesIn, connectedAt: f.connectedAt };
            return Promise.resolve(st.stats);
        }
        const h = host();
        if (!h || typeof h.stats !== 'function' || st.reading) return Promise.resolve(st.stats);
        st.reading = true;
        return Promise.resolve(st.a.kind === 'wifi' ? h.stats() : h.stats(st.a.iface)).then((r) => {
            st.reading = false;
            // an adapter's sheet takes only its own figures: an older app answers every interface with the Wi-Fi
            // adapter's (no iface in the answer), which would show Wi-Fi bytes on the Mobile Broadband sheet
            const mine = !!r && !r.error && (st.a.kind === 'wifi' || r.iface === st.a.iface || (r.kind && r.kind === st.a.kind));
            st.stats = mine ? r : (st.a.kind === 'wifi' ? st.stats : null);
            return st.stats;
        }).catch(() => { st.reading = false; return st.stats; });
    }

    // a local live view (server-push-not-polling "Allowed"): the counters once a second while the sheet is seen
    function startStatusClock(st) {
        if (!st || st.timer) return;
        st.timer = root.setInterval(() => {
            if (!st.ctx.modal.isConnected) { stopStatusClock(st); return; }
            // unseen: a hidden page, a phone's screen off, the sheet minimised
            if (doc.hidden || doc.documentElement.dataset.screenOff !== undefined || !statusSeen(st)) return;
            void readStats(st).then(() => statusPaint(st));
        }, 1000);
    }

    function stopStatusClock(st) {
        if (st && st.timer) { root.clearInterval(st.timer); st.timer = null; }
    }

    /** The Details rows of an adapter: [[property, value]] (also ipconfig's source). */
    async function detailRows(ad) {
        const info = adapterInfo(ad);
        const st = statusWins.get(ad.id || ad.iface) || { a: ad, stats: null };
        const x = (await readStats(st)) || {};
        const r = ad.row || {};
        const cfg = info.config || {};
        const lease = ad.kind === 'miniport' ? info.lease || nightshadeLease() : null;
        const pick = (k) => (Array.isArray(x[k]) && x[k].length ? x[k] : Array.isArray(r[k]) && r[k].length ? r[k] : null);
        const v4 = ((pick('ip') || info.ip) || []).map(splitCidr).filter((p) => p.address);
        const v6all = ((pick('ip6') || info.ip6) || []).map((v) => String(v).split('/')[0]);
        const temp = new Set((pick('ip6Temp') || []).map(String));
        const linkLocal = v6all.filter((p) => /^fe80:/i.test(p));
        const v6 = v6all.filter((p) => !/^fe80:/i.test(p) && !temp.has(p));
        const v6temp = v6all.filter((p) => temp.has(p));
        const dnsAll = lease ? lease.dns : (pick('dns') || (Array.isArray(cfg.dns) ? cfg.dns : []));
        const dns = dnsAll.filter((d) => !String(d).includes(':'));
        const dns6 = dnsAll.filter((d) => String(d).includes(':'));
        const dhcp = lease ? true : x.dhcp !== undefined ? !!x.dhcp : r.dhcp !== undefined ? !!r.dhcp : (ad.kind === 'mobile' || ad.kind === 'ipa' || ad.kind === 'vpn') ? false : cfg.mode !== 'static';
        const prefix = lease ? lease.prefix : v4.length && v4[0].prefix !== null ? v4[0].prefix : (Number.isFinite(Number(cfg.prefix)) && cfg.prefix !== null && cfg.prefix !== undefined ? Number(cfg.prefix) : null);
        const suffix = lease ? (lease.domain || '') : String(x.domains || r.domains || '').split(/[\s,]+/)[0] || '';
        const dhcpServer = lease ? lease.dhcpServer : (x.dhcpServer || r.dhcpServer || '');
        const times = lease ? { obtained: lease.obtainedAt, expires: lease.expiresAt } : dhcp ? leaseTimes(x.leaseFrom || r.leaseFrom, x.leaseSec || r.leaseSec) : null;
        const gateway = lease ? lease.gateway : (x.gateway || r.gateway || cfg.gateway || '');
        const gateway6 = x.gateway6 || r.gateway6 || '';
        // netshell builds each label from 'IPv4 ' / 'IPv6 ' and its singular or plural word
        const many = (label, plural, list) => (list.length ? list.map((v, i) => [i ? '' : (list.length > 1 ? plural : label), v]) : [[label, '']]);
        const desc = ad.kind === 'miniport' ? ad.label : ad.label || (ad.kind === 'mobile' ? MOBILE : '') || ad.iface || '';
        const rows = [['Connection-specific DNS Suffix', suffix], ['Description', desc], ['Physical Address', macText(x.mac || info.mac || ad.mac)], ['DHCP Enabled', dhcp ? 'Yes' : 'No']]
            .concat(many('IPv4 IP Address', 'IPv4 IP Addresses', v4.map((p) => p.address)))
            .concat([['IPv4 Subnet Mask', prefix !== null ? maskOf(prefix) : '']])
            .concat(times ? [['Lease Obtained', longDate(times.obtained)], ['Lease Expires', longDate(times.expires)]] : [])
            .concat([['IPv4 Default Gateway', gateway]])
            .concat(dhcp ? [['IPv4 DHCP Server', dhcpServer]] : [])
            .concat(many('IPv4 DNS Server', 'IPv4 DNS Servers', dns))
            .concat([['IPv4 WINS Server', ''], ['NetBIOS over Tcpip Enabled', 'Yes']])
            .concat(v6.length ? many('IPv6 IP Address', 'IPv6 IP Addresses', v6) : [])
            .concat(v6temp.length ? many('Temporary IPv6 Address', 'Temporary IPv6 Address', v6temp) : [])
            .concat(many('Link-local IPv6 Address', 'Link-local IPv6 Address', linkLocal))
            .concat([['IPv6 Default Gateway', gateway6]])
            .concat(many('IPv6 DNS Server', 'IPv6 DNS Servers', dns6));
        // the Café Miniport (#952): the Nightshade link the virtual adapter carries, after Windows' own rows
        if (ad.kind === 'miniport') {
            const f = vpnFacts();
            rows.push(['Server type', 'Xyridian Nightshade'], ['Authentication', f.authentication || 'User Password'], ['Encryption', f.encryption || ''],
                ['Compression', f.compression || '(none)'], ['Domain', f.domain || ''], ['Server name', (lease && lease.domain) || f.server || ''],
                ['Maximum data rate', f.speedKbps ? speed(f.speedKbps / 1000) : S.notAvailable], ['Latency', f.latency || S.notAvailable],
                ['Messages sent', Number(f.messagesOut || 0).toLocaleString()], ['Messages received', Number(f.messagesIn || 0).toLocaleString()]);
        }
        return rows;
    }

    // Vista's Details dates: "Wednesday, November 18, 2026 9:09:28 PM" (the VM's Lease Obtained)
    function longDate(ms) {
        const d = new Date(Number(ms));
        if (!Number.isFinite(d.getTime())) return '';
        const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
        return `${day} ${time}`;
    }

    /** A DHCP lease's obtained / expires now: Android's DHCP client renews at half the lease (T1), as Windows' does, so
     *  a lease that began at `from` was last renewed at the latest T1 mark before now. */
    function leaseTimes(fromMs, leaseSec) {
        const from = Number(fromMs);
        const len = Number(leaseSec) * 1000;
        if (!from || !(len > 0)) return null;
        const half = len / 2;
        const now = Date.now();
        const obtained = now - from < len ? from : from + Math.floor((now - from - half) / half) * half;
        return { obtained, expires: obtained + len };
    }

    /**
     * The adapter's Network Connection Details (netshell 24300), the VM's rows in its order (#952: real values where
     * the host has them, blank where Windows shows a blank). A row whose list holds several values says so in the
     * plural ("IPv4 DNS Servers"), its other values under it, as the VM draws them.
     */
    async function openDetails(owner, a) {
        const V = await kit();
        const ad = a || wifiAdapter();
        const rows = await detailRows(ad);
        V.openDialog({
            id: 'dreamosNetDetails',
            key: 'netshell:24300',
            owner,
            bareCaption: true,
            init: (c) => {
                const lv = c.holder(24301);
                if (lv) fillPropertyList(lv, rows);
            }
        });
    }

    async function setRadio(on) {
        const h = host();
        if (!h || !can('radio')) return;
        const r = await Promise.resolve(h.radio(on)).catch((e) => ({ error: String(e) }));
        if (r && r.error) await message(r.error, wifiAdapter().conn, 'error');
    }

    /** An adapter's status sheet (the wireless one with no argument). */
    /**
     * Every connection's status sheet is this one builder (#945), on netshell's two General templates: 24050 (the
     * wireless sheet: a signal meter) for Wi-Fi and Mobile Broadband, 23500 (Local Area Connection) for a cable and
     * the VPN. The same window, groups and buttons on each; what differs is the row the kind has:
     *
     *   Wireless           SSID, Signal Quality, Details..., Wireless Properties
     *   Mobile Broadband   Provider (the carrier, its data class, Roaming) where the SSID is, Signal Quality, Details...
     *                      (Windows 7's WWAN sheet: the wireless layout without Wireless Properties)
     *   Local Area         Details...
     *   VPN (the Café      RAS's sheet: General (Disconnect where Disable is, the socket's bytes) and a Details tab
     *   Miniport)          (device, server type, transports, authentication, encryption, domain, server, latency,
     *                      messages)
     */
    async function openStatus(a) {
        const ad = a || (available() ? wifiAdapter() : null);
        if (!ad) { await message(S.noInterfaces, S.statusTitle, 'warning'); return null; }
        const open = statusWins.get(ad.id || ad.iface);
        if (open && live(open.ctx.modal)) {
            if (open.ctx.modal.classList.contains('minimised')) call('restoreMinimizedModal', open.ctx.modal, call('getOrCreateTaskbarItem', open.ctx.modal) || null);
            call('bringModalToFront', open.ctx.modal);
            statusPaint(open);
            return open.ctx.modal;
        }
        const V = await kit();
        const kind = ad.kind;
        const wifi = kind === 'wifi';
        // (#952) the modem is a Local Area Connection with the app's v2 list: no signal meter (VZAccess Manager has it)
        const meter = wifi || (kind === 'mobile' && !ad.row);
        const vpn = kind === 'vpn';
        const k = vpn ? VPN_GENERAL : meter ? 'netshell:24050' : 'netshell:23500';
        // the values sit right-aligned in the LAN / wireless sheets; RAS's sheet draws them where the template has them
        const right = vpn ? [23502, 23504] : [23502, 23504, 1007, 24018, 1008, 1009, 1003, 1005];
        const icon = adapterIcon(ad);
        // the activity picture: the two screens (netshell 1915) under the adapter's mark, at 48 px (1913 wireless,
        // netshell 110 broadband, 108 the VPN's server)
        const mark = { wifi: 'netshell-activity-wireless-48', vpn: 'ncpa-vpn-48' }[kind] || (kind === 'mobile' && meter ? 'ncpa-broadband-48' : null);
        const overrides = {
            1010: { html: `<span class="dwf-activity">${img1('netshell-activity-48')}${mark ? img1(mark) : ''}</span>` },
            // the VM's status sheet shows Bytes only (no Errors row), one short rule between the counts
            1027: { skip: true }, 1012: { skip: true }, 1013: { skip: true }, 1028: { skip: true }
        };
        // the signal quality meter: pnidui's bars at their own 32 px, where the static sits
        if (meter) overrides[1044] = { image: `${NET}/tray-wifi-0-32.png`, nudge: [0, 0, 2, 31] };
        if (kind === 'mobile' && meter) {
            overrides[24016] = { text: 'Provider:' };
            overrides[24020] = { skip: true };
        }
        if (vpn) {
            // RAS's sheet: its Details are a tab, not a button; Disable is Disconnect; nothing to set for the link here.
            // Compression and Errors are counts the page cannot see (the socket's own framing): left out, as on the LAN sheet
            overrides[23506] = { skip: true };
            overrides[1026] = { disabled: true };
            overrides[1025] = { text: 'Dis&connect' };
            [1037, 1004, 1006, 1029].forEach((id) => { overrides[id] = { skip: true }; });
        }
        const pages = [{ key: k, overrides }];
        if (vpn) pages.push({ key: VPN_DETAILS, overrides: { 24202: { disabled: true } } });
        const st = { ctx: null, a: ad, key: k, timer: null, stats: null, since: Date.now(), reading: false, detailsKey: '' };
        const ctx = V.openSheet({
            id: `dreamosNetStatus-${String(ad.id || ad.iface || 'wifi').replace(/[^a-z0-9]/gi, '_')}`,
            title: fill(N.statusOf, ad.conn),
            icon,
            noApply: true,
            pages,
            init: (c) => {
                // the VM's values sit right-aligned in their column (the template's statics are left-aligned)
                right.forEach((id) => { const h = c.holder(id, k); if (h) h.classList.add('dwf-right'); });
                // Properties and Disable carry the UAC shield, as on the VM (a VPN's Disconnect does not)
                (vpn ? [1026] : [1026, 1025]).forEach((id) => {
                    const b = c.el(id, k);
                    if (b) b.insertAdjacentHTML('afterbegin', `<img class="dwf-shield" src="${SHIELD}" alt="" draggable="false">`);
                });
                if (vpn && ad.row) {
                    // a VPN app's tunnel (#952): Disconnect / Diagnose go to its app
                    const h = host();
                    const app = () => { if (h && typeof h.openVpnApp === 'function') h.openVpnApp(ad.iface); };
                    c.on(1025, 'click', app, k);
                    c.on(23505, 'click', app, k);
                    return;
                }
                if (vpn) {
                    const cp = root.melatonControlPanel;
                    c.on(1025, 'click', () => {
                        if (cp && typeof cp.toggleConnection === 'function') cp.toggleConnection();
                        root.setTimeout(() => statusPaint(st), 50);
                    }, k);
                    c.on(23505, 'click', () => { if (cp && typeof cp.diagnose === 'function') void cp.diagnose(); }, k);
                    return;
                }
                c.on(23506, 'click', () => { void openDetails(c.modal, ad); }, k);
                if (wifi) c.on(24020, 'click', () => { const n = current(); if (n) void networkProperties(String(n.name), c.modal); }, k);
                c.on(1026, 'click', () => { void adapterProperties(c.modal, ad); }, k);
                c.on(1025, 'click', () => { void setEnabled(ad, false); c.close(); }, k);
                c.on(23505, 'click', () => {
                    const cp = root.melatonControlPanel;
                    if (ad.kind === 'miniport' && cp && typeof cp.diagnose === 'function') { void cp.diagnose(); return; }
                    void diagnoseAdapter(ad);
                }, k);
            },
            close: () => { stopStatusClock(st); if (statusWins.get(ad.id || ad.iface) === st) statusWins.delete(ad.id || ad.iface); }
        });
        if (!ctx) return null;
        st.ctx = ctx;
        // the status sheet has one button, Close, where Cancel is (netshell 23020)
        const ok = ctx.content.querySelector('[data-vdt-action="ok"]');
        if (ok) ok.hidden = true;
        const cancel = ctx.content.querySelector('[data-vdt-action="cancel"]');
        if (cancel) { cancel.textContent = S.close; cancel.dataset.dialogPrimary = '1'; }
        // the caption shows the connection's icon on the VM (the wireless one; netshell's wired icons are the XP set)
        const main = ctx.modal.querySelector('.modal-window-title > div');
        if (main && !main.querySelector('.icon-image')) main.insertAdjacentHTML('afterbegin', `<img class="icon-image" src="${icon}" alt="">`);
        statusWins.set(ad.id || ad.iface, st);
        statusPaint(st);
        void readStats(st).then(() => statusPaint(st));
        startStatusClock(st);
        return ctx.modal;
    }

    /** Diagnose this connection: the wireless adapter's own checks, or what a wired / mobile adapter shows. */
    function diagnoseAdapter(a) {
        if (!a || a.kind === 'wifi') return diagnose();
        const info = adapterInfo(a);
        let text;
        let icon = 'info';
        if (!info.enabled) { text = `${a.conn} is disabled. Enable it in Network Connections.`; icon = 'warning'; } else if (a.kind === 'ethernet' && !info.carrier) {
            text = `The network cable is unplugged from ${a.conn}. Plug in a network cable.`;
            icon = 'warning';
        } else if (!info.ip.length && a.kind === 'ethernet') {
            text = `${a.conn} is connected but has not received an IP address. The network's router might not be responding, or this network needs a fixed IP address (Change settings of this connection, Internet Protocol Version 4 (TCP/IPv4), Properties).`;
            icon = 'warning';
        } else if (!info.connected) {
            text = `${a.conn} is not connected.`;
        } else {
            text = `${a.conn} has an IP address${info.ip[0] ? ` (${splitCidr(info.ip[0]).address})` : ''}. No problems were found with this connection.`;
        }
        return message(text, 'Melaton Network Diagnostics', icon);
    }

    // ---- Manage Wireless Networks (wlanpref.dll's folder, a Control Panel folder page) -----------------------------

    const MWN = 'manage-wireless-networks';
    const mwn = { sel: null, html: '', drag: null };
    let knownList = null; // provider.known()'s last answer (Round 2): the saved networks in the host's priority order

    function readKnown() {
        const h = host();
        if (!h || typeof h.known !== 'function') return Promise.resolve(null);
        return Promise.resolve(h.known()).then((r) => {
            knownList = r && Array.isArray(r.networks) ? r.networks.filter((n) => n && n.name) : knownList;
            return knownList;
        }).catch(() => knownList);
    }

    function mwnList() {
        // the host's own list and order when it keeps one
        if (knownList) {
            return knownList.map((n) => {
                const live = scanned.find((x) => x.name === n.name);
                const auto = n.autoConnect !== undefined && n.autoConnect !== null ? n.autoConnect !== false : !live || live.autoConnect !== false;
                return { name: String(n.name), security: n.security || (live && live.security) || 'psk', auto };
            });
        }
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
            ${sel ? btn('remove', 'wlanpref-remove-16', 'Remove', can('forget')) : ''}
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

    /** Redraw the page when it shows and its markup changed (force: after this page's own change). */
    function mwnRerender(force) {
        const cp = root.melatonControlPanel;
        if (!cp || typeof cp.currentPage !== 'function' || cp.currentPage() !== MWN || mwn.drag) return;
        const html = mwnBody();
        if (!force && html === mwn.html) return;
        mwn.html = html;
        cp.navigate(MWN, { replace: true });
    }

    /** The new priority order: the host's (provider.order) when it keeps one, else this browser's list. */
    async function mwnOrder(names) {
        const h = host();
        if (h && typeof h.order === 'function' && can('order')) {
            // drawn in the new order at once; the host's answer (known()) confirms it
            if (knownList) knownList = names.map((n) => knownList.find((x) => x.name === n)).filter(Boolean);
            mwnRerender(true);
            const r = await Promise.resolve(h.order(names)).catch((e) => ({ error: String((e && e.message) || e) }));
            if (r && r.error) await message(r.error, S.manage, 'error');
            await readKnown();
            mwnRerender(true);
            return;
        }
        const list = mwnList();
        storeSaved(names.map((n) => list.find((x) => x.name === n)).filter(Boolean).map((x) => ({ name: x.name, security: x.security, auto: x.auto })));
        mwnRerender(true);
    }

    function mwnMove(delta) {
        const list = mwnList();
        const i = list.findIndex((x) => x.name === mwn.sel);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        const names = list.map((x) => x.name);
        const [it] = names.splice(i, 1);
        names.splice(j, 0, it);
        void mwnOrder(names);
    }

    // Drag a network up or down (wlanpref 20006): pointer events, no browser drag image; Vista's list view
    // insertion mark (a line with end ticks) shows where it lands. Wired once on the document (this file's segment
    // signal), as the page's markup is redrawn.
    function mwnDragWire() {
        if (mwnDragWire.done || !doc) return;
        mwnDragWire.done = true;
        const end = (drop) => {
            const d = mwn.drag;
            if (!d) return;
            mwn.drag = null;
            if (d.mark) d.mark.remove();
            if (d.tile) d.tile.classList.remove('is-dragging');
            if (drop && d.moved && d.to !== null) {
                const names = mwnList().map((x) => x.name);
                const from = names.indexOf(d.name);
                let to = d.to;
                if (from >= 0) {
                    names.splice(from, 1);
                    if (to > from) to -= 1;
                    names.splice(to, 0, d.name);
                    if (to !== from) { void mwnOrder(names); return; }
                }
            }
            mwnRerender();
        };
        doc.addEventListener('pointerdown', (ev) => {
            const tile = ev.button === 0 && ev.target.closest && ev.target.closest('.cpl-instance .dwf-mwn-tile');
            if (!tile) return;
            mwn.drag = { tile, name: tile.dataset.id, x: ev.clientX, y: ev.clientY, moved: false, to: null, mark: null, id: ev.pointerId };
        }, { signal: appScopeSignal });
        doc.addEventListener('pointermove', (ev) => {
            const d = mwn.drag;
            if (!d || ev.pointerId !== d.id) return;
            if (!d.moved) {
                if (Math.abs(ev.clientX - d.x) < 4 && Math.abs(ev.clientY - d.y) < 4) return;
                d.moved = true;
                d.tile.classList.add('is-dragging');
                d.mark = doc.createElement('div');
                d.mark.className = 'dwf-mwn-insert';
                d.tile.parentElement.appendChild(d.mark);
            }
            ev.preventDefault();
            // the tiles flow in rows: the gap beside the nearest tile, on the pointer's side of its middle; the mark is
            // the list view's insertion mark, an upright line in that gap
            const tiles = Array.from(d.tile.parentElement.querySelectorAll('.dwf-mwn-tile'));
            let best = 0;
            let bestD = Infinity;
            tiles.forEach((t, i) => {
                const r = t.getBoundingClientRect();
                const dx = Math.max(r.left - ev.clientX, 0, ev.clientX - r.right);
                const dy = Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom);
                const dist = dy * 1000 + dx;
                if (dist < bestD) { bestD = dist; best = i; }
            });
            const r = tiles[best].getBoundingClientRect();
            const after = ev.clientX > r.left + r.width / 2;
            d.to = best + (after ? 1 : 0);
            const box = d.tile.parentElement.getBoundingClientRect();
            const x = after ? r.right + 3 : r.left - 5;
            d.mark.style.transform = `translate(${Math.round(x - box.left)}px, ${Math.round(r.top - box.top)}px)`;
            d.mark.style.height = `${Math.round(r.height)}px`;
        }, { signal: appScopeSignal });
        doc.addEventListener('pointerup', (ev) => { if (mwn.drag && ev.pointerId === mwn.drag.id) end(true); }, { signal: appScopeSignal });
        doc.addEventListener('pointercancel', () => end(false), { signal: appScopeSignal });
        doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && mwn.drag) end(false); }, { signal: appScopeSignal });
        // no browser drag of the tile's picture or text
        doc.addEventListener('dragstart', (ev) => { if (ev.target.closest && ev.target.closest('.cpl-instance .dwf-mwn-tile')) ev.preventDefault(); }, { signal: appScopeSignal });
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
                await readKnown();
                mwnRerender(true);
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
        mwnDragWire();
        // Control Panel keeps the first registration of a page id: its body asks this file's current copy (a live
        // update of this file replaces window.dreamosWifi), so the page and the handlers below never part
        cp.registerPage(MWN, { kind: 'folder', parent: 'cat-network', title: () => S.manage, icon16: `${NET}/wlanpref-manage-16.png`, tasks: () => '', body: () => (root.dreamosWifi && root.dreamosWifi._manageBody ? root.dreamosWifi._manageBody() : '') });
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
                    fitBars(win);
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
        const into = callerWindow();
        if (!available()) { await message(S.noInterfaces, S.manage, 'warning'); return; }
        const fl = root.featureLoader;
        await Promise.resolve(fl && fl.loadFeature ? fl.loadFeature('control_panel') : null);
        await kit();
        if (!registerManage()) return;
        await Promise.all([readList(), readKnown()]);
        mwn.html = '';
        root.melatonControlPanel.open(MWN, into ? { window: into } : {});
    }

    // ---- Network Connections (ncpa.cpl: netshell's folder, a Control Panel folder page) ----------------------------

    const NC = 'network-connections';
    const nc = { sel: null, renaming: null, html: '' };
    const EXPLORER = '/static_images/vista-explorer';

    /** The Nightshade Network (the domain connection Control Panel already shows), as Vista lists a VPN connection. */
    function vpnRow() {
        const ns = nightshade();
        const d = root.melatonNetworkDialogs;
        let device = 'WAN Miniport (L-PPoP)';
        try { if (d && typeof d.miniportLabel === 'function' && typeof d.connectionInfo === 'function') device = d.miniportLabel(d.connectionInfo()) || device; } catch (_) { /* default */ }
        return { key: 'vpn', kind: 'vpn', conn: ns.name, status: ns.connected ? N.connected : N.disconnectedVpn, device, look: ns.connected ? 'on' : 'off', connected: ns.connected };
    }

    // ---- VPN connection objects (#952): Connect to a workplace's connections, kept on this computer (dreamosVpn.js reads
    // and writes them; this file lists them without loading it) ------------------------------------------------------
    const VPN_KEY = 'dreamos.ncpa.vpn';
    function vpnObjects() {
        try { const v = JSON.parse(root.localStorage.getItem(VPN_KEY) || '[]'); return Array.isArray(v) ? v.filter((o) => o && o.id && o.name) : []; } catch (_) { return []; }
    }
    /** dreamosVpn.js (featureLoader 'network_vpn'): the wizard, Connect, Properties. */
    function vpnLib() {
        const fl = root.featureLoader;
        return Promise.resolve(fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('network_vpn') : null).then(() => root.dreamosVpn || null);
    }
    /** A VPN app's tunnel up or down through the app (AndroidWifi.vpnControl, DSApp claude/vpn-info): true when asked. */
    function vpnControl(row, up) {
        const h = host();
        if (!row || !row.vpnPackage || !h || typeof h.vpnControl !== 'function') return false;
        Promise.resolve(h.vpnControl(row.vpnPackage, row.vpnSession || '', !!up)).then((res) => {
            if (res && res.error) void message(res.error, row.vpnSession || row.vpnApp || 'VPN', 'error');
            root.setTimeout(() => { void readIfaces().then(ncRerender); }, 1500);
        }).catch(() => {});
        return true;
    }

    function vpnObjectRow(o) {
        // a connection to this server is up while the Nightshade link is (dreamosVpn.isNightshade); the rest never are
        const lib = root.dreamosVpn;
        const up = !!(lib && typeof lib.connected === 'function' && lib.connected(o));
        const device = o.type === 'pptp' ? 'WAN Miniport (PPTP)' : 'WAN Miniport (L2TP)';
        return { key: `vo:${o.id}`, kind: 'vpn', vo: o, a: { iface: 'vo', id: `vo:${o.id}`, kind: 'vpn', label: device, base: o.name, conn: o.name }, conn: o.name, status: up ? N.connected : N.disconnectedVpn, device, look: up ? 'on' : 'off', enabled: true, connected: up };
    }

    /** Delete this connection: Vista's confirmation (netshell "Confirm Connection Delete"). */
    async function vpnDelete(r) {
        if (r.connected) { await message('You cannot delete a connection while it is connected or busy connecting. Please disconnect or close the login property page and try again.', 'Network Connections', 'error'); return; }
        const ok = await Promise.resolve(call('showConfirmationDialog', esc(`Are you sure you want to delete '${r.conn}'?`),
            [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null,
            { title: 'Confirm Connection Delete', icon: 'fas fa-exclamation-triangle', sound: true }));
        if (ok !== true) return;
        try { root.localStorage.setItem(VPN_KEY, JSON.stringify(vpnObjects().filter((o) => o.id !== r.vo.id))); } catch (_) { /* private window */ }
        nc.sel = null;
        ncRerender();
    }

    /** The redrawn command bar keeps Vista's overflow: what does not fit goes under » (melatonControlPanel). */
    function fitBars(win) {
        const cp = root.melatonControlPanel;
        if (win && cp && typeof cp.fitCommandBars === 'function') cp.fitCommandBars(win);
    }

    function ncRows() {
        const list = adapters();
        const rows = list.map((a) => {
            const info = adapterInfo(a);
            const look = !info.enabled ? 'off' : (LAN_KINDS.has(a.kind) && a.kind !== 'miniport' && a.row ? !info.carrier : a.kind === 'ethernet' ? !info.carrier : !info.connected) ? 'x' : 'on';
            return { key: `if:${a.id || a.iface}`, kind: a.kind, a, conn: a.conn, status: adapterStatus(a, info), device: a.label || a.iface, look, enabled: info.enabled, connected: info.connected };
        });
        // the Café Miniport is an adapter now (#952); without it (a browser, Continuity) the Nightshade link stays a VPN
        const objects = vpnObjects().map(vpnObjectRow);
        return (list.some((a) => a.kind === 'miniport') ? rows : rows.concat([vpnRow()])).concat(objects);
    }

    function ncBar(rows) {
        const r = rows.find((x) => x.key === nc.sel) || null;
        const btn = (v, icon, t, on = true) => `<button type="button" class="cpl-fbar-btn" data-cpl-vpage="${v}"${on ? '' : ' disabled'}>${icon ? img(icon) : ''}${esc(t)}</button>`;
        let cmds = '';
        if (r && r.vo) {
            // a Connect to a workplace connection (#952): Vista's VPN bar, Delete this connection included
            cmds = btn(r.connected ? 'vpnstop' : 'vpnstart', r.connected ? 'ncpa-disable-16' : 'ncpa-connect-16', r.connected ? N.stop : N.start)
                + btn('rename', 'ncpa-rename-16', N.rename)
                + btn('vodelete', 'ncpa-delete-16', N.remove, !r.connected)
                + btn('settings', 'ncpa-settings-16', N.settings);
        } else if (r && r.kind === 'vpn') {
            cmds = btn(r.connected ? 'vpnstop' : 'vpnstart', r.connected ? 'ncpa-disable-16' : 'ncpa-connect-16', r.connected ? N.stop : N.start)
                + btn('rename', 'ncpa-rename-16', N.rename)
                // (no Delete this connection: the Nightshade Network is the domain's own connection, and Vista's bar
                // leaves out what a connection cannot do)
                + btn('settings', 'ncpa-settings-16', N.settings);
        } else if (r && r.enabled) {
            cmds = (r.kind === 'wifi' ? btn('connectto', 'ncpa-connect-16', N.connectTo) : '')
                + btn('disable', 'ncpa-disable-16', N.disable, canSwitch(r.a))
                + btn('diagnose', 'ncpa-diagnose-16', N.diagnose)
                + btn('rename', 'ncpa-rename-16', N.rename)
                + btn('status', 'ncpa-status-16', N.status)
                + btn('settings', 'ncpa-settings-16', N.settings);
        } else if (r) {
            cmds = btn('enable', 'ncpa-enable-16', N.enable, canSwitch(r.a))
                + btn('diagnose', 'ncpa-diagnose-16', N.diagnose)
                + btn('rename', 'ncpa-rename-16', N.rename)
                + btn('settings', 'ncpa-settings-16', N.settings);
        }
        return `<div class="cpl-fbar" role="toolbar">
            <button type="button" class="cpl-fbar-btn" data-cpl-vpage="organize"><img src="${EXPLORER}/organize.png" alt="">Organize<span class="cpl-fbar-glyph"></span></button>
            <button type="button" class="cpl-fbar-btn" data-cpl-vpage="views"><img src="${EXPLORER}/views-${ncView()}.png" srcset="${EXPLORER}/views-${ncView()}.png 1x, ${EXPLORER}/views-${ncView()}@2x.png 2x" alt="">Views<span class="cpl-fbar-glyph"></span></button>
            ${cmds}
            <button type="button" class="cpl-fbar-help" data-cpl-vpage="help" data-topic="network-connections"><img src="${EXPLORER}/help-16.png" alt=""></button>
        </div>`;
    }

    function ncTile(r) {
        return `<div class="cpl-ficon dwf-nc-tile${r.key === nc.sel ? ' is-selected' : ''}" data-cpl-vpage="pick" data-id="${esc(r.key)}" tabindex="0">${connPicture(r.kind, r.look)}`
            + `<span class="dwf-nc-text"><span class="dwf-nc-name">${esc(r.conn)}</span><span class="vdt-graytext">${esc(r.status)}</span><span class="vdt-graytext">${esc(r.device)}</span></span></div>`;
    }

    // ---- Views (#952): the VM's seven views of Network Connections (Explorer's slider menu, vfsVirtualGrid.js
    // vistaViewsMenu); Tiles is the folder's own. Kept per computer, as Vista keeps a folder's view.
    const VIEW_KEY = 'dreamos.ncpa.view';
    const VIEWS = new Set(['icons-xl', 'icons-lg', 'icons-md', 'icons-sm', 'list', 'details', 'tiles']);
    function ncView() {
        let v = '';
        try { v = root.localStorage.getItem(VIEW_KEY) || ''; } catch (_) { v = ''; }
        return VIEWS.has(v) ? v : 'tiles';
    }
    function setNcView(v) {
        if (!VIEWS.has(v)) return;
        try { root.localStorage.setItem(VIEW_KEY, v); } catch (_) { /* private window */ }
        nc.html = '';
        ncRerender();
    }
    const icon16 = (kind) => (kind === 'wifi' ? `${NET}/netshell-wireless-16.png` : kind === 'vpn' ? `${NET}/ncpa-vpn-16.png` : `${NET}/ncpa-lan-16.png`);

    /** The Details view's columns for a row, as the VM fills them (Connectivity "Access to Local and Internet",
     *  Network Category "Private network", Owner "System" or the user who made the connection, Type the group). */
    function ncDetails(r, type) {
        let connectivity = '';
        let category = '';
        if (r.connected) {
            const info = r.a && r.kind !== 'vpn' ? adapterInfo(r.a) : null;
            const local = r.kind === 'miniport' || (r.kind === 'vpn' && !r.a) || (info && info.row && !info.dataLink && r.kind !== 'vpn');
            connectivity = local || !reachesInternet() ? 'Access to Local only' : 'Access to Local and Internet';
            category = r.kind === 'miniport' || (r.kind === 'vpn' && !r.vo && !(r.a && r.a.row)) ? 'Domain network' : 'Private network';
        }
        let owner = 'System';
        if (r.vo) {
            const acc = root.meletonAccounts;
            owner = r.vo.owner || (acc && typeof acc.name === 'function' ? acc.name() : '') || '';
        }
        const lease = nightshadeLease();
        const hostAddr = r.vo ? r.vo.host : (r.kind === 'vpn' && !r.a ? ((lease && lease.domain) || '') : '');
        return [r.conn, r.status, r.device, connectivity, category, owner, type, hostAddr];
    }

    function ncItem(r, view, type) {
        const sel = r.key === nc.sel ? ' is-selected' : '';
        const attrs = `data-cpl-vpage="pick" data-id="${esc(r.key)}" tabindex="0"`;
        if (view === 'tiles') return ncTile(r);
        if (view === 'details') {
            return `<div class="dwf-nc-drow${sel}" ${attrs}>${ncDetails(r, type).map((v, i) => `<span class="dwf-nc-dcol dwf-nc-dcol${i}">${i === 0 ? `<img src="${icon16(r.kind)}" alt="" draggable="false">` : ''}<span class="${i === 0 ? 'dwf-nc-name' : ''}">${esc(v)}</span></span>`).join('')}</div>`;
        }
        if (view === 'list' || view === 'icons-sm') {
            return `<div class="dwf-nc-small${sel}" ${attrs}><img src="${icon16(r.kind)}" alt="" draggable="false"><span class="dwf-nc-name">${esc(r.conn)}</span></div>`;
        }
        // Medium / Large / Extra Large Icons: the picture over its name
        return `<div class="dwf-nc-icon dwf-nc-icon-${view}${sel}" ${attrs}>${connPicture(r.kind, r.look)}<span class="dwf-nc-name">${esc(r.conn)}</span></div>`;
    }

    // ---- Organize (#952): the VM's menu for this folder, through Control Panel's shared Organize button (cplPages3.js
    // organizeMenu: organizeOwn, organizeItems; a pick runs handler cpl-org:<name>); what the folder cannot do is greyed
    function ncOrganizeItems() {
        const r = ncRow();
        const nightshade = !!r && r.kind === 'vpn' && !r.vo && !(r.a && r.a.row);
        return [
            { text: 'New Folder', action: 'cpl-org:none', disabled: true },
            { separator: true },
            { text: 'Cut', icon: 'fas fa-cut', action: 'cpl-org:none', disabled: true },
            { text: 'Copy', icon: 'fas fa-copy', action: 'cpl-org:none', disabled: true },
            { text: 'Paste', icon: 'fas fa-paste', action: 'cpl-org:none', disabled: true },
            { text: 'Undo', action: 'cpl-org:none', disabled: true },
            { text: 'Redo', action: 'cpl-org:none', disabled: true },
            { separator: true },
            { text: 'Select All', action: 'cpl-org:orgSelectAll', disabled: !ncRows().length },
            { separator: true },
            // Layout: this folder has no panes or menu bar to show here (greyed, as the panes it does not have)
            { text: 'Layout', hasSubmenu: true, submenu: ['Menu Bar', 'Details Pane', 'Preview Pane', 'Navigation Pane'].map((t) => ({ text: t, action: 'cpl-org:none', disabled: true })) },
            { text: 'Folder and Search Options', action: 'cpl-org:orgFolderOptions' },
            { separator: true },
            { text: 'Delete', icon: 'fas fa-xmark', action: 'cpl-org:vodelete', disabled: !(r && r.vo && !r.connected) },
            { text: 'Rename', action: 'cpl-org:orgRename', disabled: !r || nightshade },
            { text: 'Remove Properties', action: 'cpl-org:none', disabled: true },
            { text: 'Properties', action: 'cpl-org:settings', disabled: !r },
            { separator: true },
            { text: 'Close', action: 'cpl-org:orgClose' }
        ];
    }

    function ncBody() {
        const rows = ncRows();
        if (!rows.some((x) => x.key === nc.sel)) nc.sel = null;
        const view = ncView();
        // Tiles, grouped by type as the VM shows them
        // (#952) with the app's v2 list the modem is a Local Area Connection (LAN mode); an older app's mobile row stays Broadband
        const v2 = rows.some((x) => x.a && x.a.row);
        const lanLike = (x) => x.kind === 'wifi' || x.kind === 'ethernet' || (v2 || x.kind === 'miniport' ? LAN_KINDS.has(x.kind) : false);
        const groups = [[N.lan, rows.filter(lanLike)], [N.broadband, rows.filter((x) => x.kind === 'mobile' && !lanLike(x))], [N.vpnGroup, rows.filter((x) => x.kind === 'vpn')]].filter((g) => g[1].length);
        const head = `<div class="cpl-flist-head dwf-nc-head">${N.cols.map((t, i) => `<span class="dwf-nc-col dwf-nc-col${i}">${esc(t)}</span>`).join('')}<span class="cpl-flist-rest"></span></div>`;
        // List is one run of names without groups (the VM's); every other view keeps the groups
        const body = view === 'list'
            ? `<div class="cpl-flist-icons dwf-nc-items dwf-nc-view-list">${groups.flatMap(([t, rs]) => rs.map((r) => ncItem(r, view, t))).join('')}</div>`
            : groups.map(([t, rs]) => `<div class="vdt-lv-group">${esc(t)} (${rs.length})</div><div class="cpl-flist-icons dwf-nc-tiles dwf-nc-items dwf-nc-view-${view}">${rs.map((r) => ncItem(r, view, t)).join('')}</div>`).join('');
        return `${ncBar(rows)}<div class="cpl-flist dwf-nc-list" data-nc-view="${view}">${head}${body}</div><div class="cpl-fstatus">${rows.length} item${rows.length === 1 ? '' : 's'}</div>`;
    }

    /** Redraw the page when it shows and its markup changed (a push that changes nothing writes nothing). */
    function ncRerender() {
        const cp = root.melatonControlPanel;
        if (!cp || typeof cp.currentPage !== 'function' || cp.currentPage() !== NC || nc.renaming) return;
        const html = ncBody();
        if (html === nc.html) return;
        nc.html = html;
        cp.navigate(NC, { replace: true });
    }

    const ncRow = () => ncRows().find((x) => x.key === nc.sel) || null;

    function ncOpen(id) {
        if (nc.renaming) return;
        const r = ncRows().find((x) => x.key === id);
        if (!r) return;
        if (r.vo) {
            // connected: the Nightshade link's status (the connection reaches this server); otherwise Connect <name>
            if (r.connected) { void openStatus(vpnAdapter()); return; }
            void vpnLib().then((lib) => lib && lib.openConnect(r.vo.id));
            return;
        }
        if (r.kind === 'vpn' && r.a && r.a.row) {
            // a VPN app's tunnel (#952): its status while it is up, else its app (where the tunnel is switched)
            if (r.connected) void openStatus(r.a);
            else if (!vpnControl(r.a.row, true)) { const h = host(); if (h && typeof h.openVpnApp === 'function') h.openVpnApp(r.a.iface); }
            return;
        }
        if (r.kind === 'miniport') { void openStatus(r.a); return; }
        if (r.kind === 'vpn') {
            // connected: its status; otherwise its client connects it (Vista's Connect dialog)
            const cp = root.melatonControlPanel;
            if (r.connected && cp && typeof cp.openStatusDialog === 'function') cp.openStatusDialog();
            else if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open();
            return;
        }
        // a disabled adapter is enabled by a double-click, as on Vista
        if (!r.enabled) { if (canSwitch(r.a)) void setEnabled(r.a, true); return; }
        void openStatus(r.a);
    }

    /** Rename this connection: Vista edits the tile's name in place. */
    function ncRename(t) {
        const r = ncRow();
        if (!r) return;
        if (r.kind === 'vpn' && !r.vo) {
            const cp = root.melatonControlPanel;
            if (cp && typeof cp.openCustomizeDialog === 'function') cp.openCustomizeDialog('connection');
            return;
        }
        const win = t && t.closest('.cpl-instance');
        const tile = win && win.querySelector(`.dwf-nc-list [data-cpl-vpage="pick"][data-id="${CSS.escape(r.key)}"]`);
        const name = tile && tile.querySelector('.dwf-nc-name');
        if (!name) return;
        nc.renaming = r.key;
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'tbp-edit dwf-nc-rename';
        input.value = r.conn;
        input.maxLength = 256;
        input.spellcheck = false;
        input.autocomplete = 'off';
        name.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const end = async (commit) => {
            if (done) return;
            const v = input.value;
            if (commit && v !== r.conn) {
                // tcpipcfg-style checks are netshell's: no tabs, not only spaces, none of \/:*?<>|"
                if (!v.trim() || /[\\/:*?<>|"\t]/.test(v)) { done = true; await message(N.renameChars, N.renameTitle, 'error'); done = false; input.focus(); input.select(); return; }
                if (ncRows().some((x) => x.key !== r.key && x.conn.toLowerCase() === v.toLowerCase())) { done = true; await message(N.renameExists, N.renameTitle, 'error'); done = false; input.focus(); input.select(); return; }
                // a VPN connection object keeps its own name (its phone book entry, #952)
                if (r.vo) {
                    const all = vpnObjects();
                    const it = all.find((o) => o.id === r.vo.id);
                    if (it) { it.name = v; try { root.localStorage.setItem(VPN_KEY, JSON.stringify(all)); } catch (_) { /* private window */ } }
                } else storeName(r.a.id || r.a.iface, v === r.a.base ? '' : v);
            }
            done = true;
            nc.renaming = null;
            nc.html = '';
            ncRerender();
        };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); void end(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); void end(false); }
        });
        input.addEventListener('blur', () => { void end(true); });
        input.addEventListener('click', (ev) => ev.stopPropagation());
        input.addEventListener('dblclick', (ev) => ev.stopPropagation());
    }

    function registerConnections() {
        const cp = root.melatonControlPanel;
        const K = root.cplPages;
        if (!cp || typeof cp.registerPage !== 'function') return false;
        // the body asks this file's current copy (a live update replaces window.dreamosWifi), see registerManage
        cp.registerPage(NC, { kind: 'folder', parent: 'cat-network', title: () => N.title, icon16: `${NET}/netcenter-16.png`, tasks: () => '', body: () => (root.dreamosWifi && root.dreamosWifi._connectionsBody ? root.dreamosWifi._connectionsBody() : '') });
        // (the handlers are this copy's, replaced by a newer copy's on its first open, as the page's body is)
        if (K && K.handlers) {
            const go = (fn) => () => { const r = ncRow(); if (r) fn(r); };
            K.handlers[NC] = {
                pick(t) {
                    if (nc.renaming) return;
                    nc.sel = t.dataset.id;
                    t.closest('.cpl-flist').querySelectorAll('[data-cpl-vpage="pick"].is-selected').forEach((n) => n.classList.remove('is-selected'));
                    t.classList.add('is-selected');
                    const win = t.closest('.cpl-instance');
                    const bar = win && win.querySelector('.cpl-fbar');
                    if (bar) bar.outerHTML = ncBar(ncRows());
                    fitBars(win);
                },
                open(id) { ncOpen(id); },
                connectto() { void openConnect(); },
                disable: go((r) => { void setEnabled(r.a, false); }),
                enable: go((r) => { void setEnabled(r.a, true); }),
                diagnose: go((r) => { void diagnoseAdapter(r.a); }),
                rename(t) { ncRename(t); },
                status: go((r) => { void openStatus(r.a); }),
                vodelete: go((r) => { if (r.vo) void vpnDelete(r); }),
                settings: go((r) => {
                    if (r.vo) { void vpnLib().then((lib) => lib && lib.openProperties(r.vo.id)); return; }
                    if (r.kind === 'vpn') { if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open(); return; }
                    void adapterProperties(null, r.a);
                }),
                // a VPN app's tunnel (#952) is switched in its app; the Nightshade link in its client
                vpnstart() {
                    const r0 = ncRow();
                    if (r0 && r0.vo) { void vpnLib().then((lib) => lib && lib.openConnect(r0.vo.id)); return; }
                    // a VPN app's tunnel (#952): WireGuard connects through its remote control, any other app opens
                    if (r0 && r0.a && r0.a.row && vpnControl(r0.a.row, true)) return;
                    const r = ncRow(); const h = host(); if (r && r.a && r.a.row && h && typeof h.openVpnApp === 'function') { h.openVpnApp(r.a.iface); return; } if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open(); },
                vpnstop() {
                    const r0 = ncRow();
                    if (r0 && r0.vo) {
                        // a connection to this server: its link is the Nightshade link (the Nightshade client asks first)
                        if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open();
                        return;
                    }
                    if (r0 && r0.a && r0.a.row && vpnControl(r0.a.row, false)) return;
                    const r = ncRow(); const h = host(); if (r && r.a && r.a.row && h && typeof h.openVpnApp === 'function') { h.openVpnApp(r.a.iface); return; } if (root.nightshadeClient && typeof root.nightshadeClient.open === 'function') root.nightshadeClient.open(); },
                organize() {},
                organizeOwn: true,
                organizeItems: () => ncOrganizeItems(),
                orgSelectAll() {
                    // one connection at a time here: the first, as a click on it would
                    const cp = root.melatonControlPanel;
                    const win = cp && typeof cp.currentWindow === 'function' ? cp.currentWindow() : null;
                    const first = win && win.querySelector('.dwf-nc-list [data-cpl-vpage="pick"]');
                    if (first && root.cplPages.handlers[NC].pick) root.cplPages.handlers[NC].pick(first);
                },
                orgFolderOptions() { const cp = root.melatonControlPanel; if (cp && typeof cp.doAction === 'function') cp.doAction('dialog:folder-options'); },
                orgRename() {
                    const cp = root.melatonControlPanel;
                    const win = cp && typeof cp.currentWindow === 'function' ? cp.currentWindow() : null;
                    ncRename(win && win.querySelector('.cpl-fbar'));
                },
                orgClose() { const cp = root.melatonControlPanel; if (cp && typeof cp.close === 'function') cp.close(); },
                // Views: a click on its face steps through the views, its ▾ drops the slider (Explorer's split button)
                views(t, ev) {
                    const vm = root.vistaViewsMenu;
                    const owner = { get: ncView, set: setNcView };
                    if (!vm) return;
                    const box = t.getBoundingClientRect();
                    const glyph = (ev && ev.target && ev.target.closest && ev.target.closest('.cpl-fbar-glyph')) || (ev && ev.clientX > box.right - 20);
                    if (glyph || typeof vm.next !== 'function') vm.toggle(t, owner);
                    else setNcView(vm.next(ncView()));
                }
            };
            if (root.cplSort && typeof root.cplSort.columns === 'function') root.cplSort.columns(NC, N.cols);
            if (typeof K.wire === 'function') K.wire();
        }
        return true;
    }

    /** The Control Panel window whose link is running (an async opener keeps it, so the page opens in that window). */
    const callerWindow = () => {
        const cp = root.melatonControlPanel;
        return cp && typeof cp.callerWindow === 'function' ? cp.callerWindow() : null;
    };

    async function openConnections() {
        const into = callerWindow();
        const fl = root.featureLoader;
        await Promise.resolve(fl && fl.loadFeature ? fl.loadFeature('control_panel') : null);
        await kit();
        if (!registerConnections()) return;
        await readIfaces();
        nc.html = '';
        root.melatonControlPanel.open(NC, into ? { window: into } : {});
    }

    // ---- Set up a connection or network (xwizards with connect.dll's and wlanpref.dll's pages) -----------------------

    // connect.dll.mui and wlanpref.dll.mui; the wireless router line is the VM's own list
    const W = {
        title: 'Set up a connection or network', // 3131
        internet: 'Connect to the Internet', // 3301
        manual: 'Manually connect to a wireless network', // wlanpref 10902
        choose: 'Choose a connection option', // 3561
        already: 'You are already connected to the Internet', // 3311
        how: 'How do you want to connect?', // 3711
        testing: 'Testing your Internet connection...', // 3331
        failed: 'The Internet connectivity test was unsuccessful', // 3341
        connected: 'You are connected to the Internet', // 3391
        cannot: 'The wizard cannot continue', // 3801
        noDetails: 'There are no details available for this problem.', // 3810
        noHardware: 'Melaton did not detect any networking hardware', // 3712
        enter: 'Enter information for the wireless network you want to add', // wlanpref 10911
        adding: 'Adding %1...', // 10935
        added: 'Successfully added %1', // 10922
        badName: 'Invalid Network Name', // 10918
        nameEmpty: 'The network name must not be empty.', // 213
        nameLong: 'The network name \'%1\' is too long. It exceeds 32 characters.', // 214
        badKey: 'Invalid passphrase', // 216
        keyRule: 'A WPA2-Personal password must be one of the following:\n8~63 case-sensitive characters\n64 characters using digits 0-9 and letters A-F', // 502
        keyRuleWpa: 'A WPA-Personal password must be one of the following:\n8~63 case-sensitive characters\n64 characters using digits 0-9 and letters A-F' // 10938
    };
    const OPTIONS = [
        { id: 'internet', icon: 'setup-internet-32', name: 'Connect to the Internet', text: 'Set up a wireless, broadband, or dial-up connection to the Internet.' }, // 3101 / 3103
        { id: 'router', icon: 'setup-router-32', name: 'Set up a wireless router or access point', text: 'Set up a new wireless network for your home or small business.' },
        { id: 'wireless', icon: 'setup-wireless-32', name: 'Manually connect to a wireless network', text: 'Choose this to connect to a hidden network or create a new wireless profile.', wifi: true }, // wlanpref 10902 / 10903
        { id: 'adhoc', icon: 'setup-adhoc-32', name: 'Set up a wireless ad hoc (computer-to-computer) network', text: 'Set up a temporary network for sharing files or an Internet connection.', wifi: true }, // wlanpref 259 / 260
        { id: 'dialup', icon: 'setup-dialup-32', name: 'Set up a dial-up connection', text: 'Connect through a dial-up connection to the Internet.' }, // 3171 / 3173
        { id: 'workplace', icon: 'setup-workplace-32', name: 'Connect to a workplace', text: 'Set up a dial-up or VPN connection to your workplace.' } // 3111 / 3113
    ];
    // Manually connect's security types (wlanpref 10904-10910): the ones the host can join with connect(ssid, key)
    const SECURITY = [
        { value: 'open', text: 'No authentication (Open)', ciphers: ['None'] },
        { value: 'wpa', text: 'WPA-Personal', ciphers: ['TKIP', 'AES'] },
        { value: 'wpa2', text: 'WPA2-Personal', ciphers: ['AES', 'TKIP'] }
    ];

    let setup = null; // { ctx, sel, pending }

    /** The wizard's caption names the flow a page belongs to (connect.dll: "Connect to the Internet" on its pages). */
    function setupTitle(c, text) {
        if (typeof c.setTitle === 'function') c.setTitle(text);
    }

    const online = () => {
        const s = state();
        const wired = (Array.isArray(s.ethernet) ? s.ethernet : []).some((l) => l && l.carrier && Array.isArray(l.ip) && l.ip.length);
        const any = wired || !!current() || !!(s.mobile && s.mobile.connected);
        return host() ? any && reachesInternet() : !root.navigator || root.navigator.onLine !== false;
    };
    const firstLan = () => adapters().find((a) => a.kind === 'ethernet') || null;

    function setupList() {
        const wifi = available();
        return OPTIONS.filter((o) => !o.wifi || wifi);
    }

    function setupListHtml() {
        return `<div class="vdt-listview is-tiles vdt-edge dwf-sw-list" tabindex="0" role="listbox" aria-label="${esc(W.choose)}">${setupList().map((o) => `<div class="vdt-lv-row dwf-sw-row${setup && setup.sel === o.id ? ' is-selected' : ''}" data-key="${o.id}" role="option">`
            + `<span class="dwf-sw-icon">${img(o.icon)}</span><span class="dwf-sw-text"><span class="vdt-lv-label">${esc(o.name)}</span><span class="vdt-lv-note">${esc(o.text)}</span></span></div>`).join('')}</div>`;
    }

    const cmdText = (c, id, key, main, note) => {
        const b = c.el(id, key);
        if (b) b.innerHTML = `<span class="vdt-cmdlink-main">${esc(main)}</span>${note ? `<span class="vdt-cmdlink-note">${esc(note)}</span>` : ''}`;
    };

    /** The internet test: the host's word after a moment (a local check; no request leaves the device). */
    function runTest(c) {
        const mine = setup;
        root.setTimeout(() => {
            if (!setup || setup !== mine || !c.modal.isConnected) return;
            c.go(online() ? 'connect:103' : 'connect:109');
        }, 1500);
    }

    async function runAdd(c) {
        const p = setup && setup.pending;
        const h = host();
        if (!p || !h) return;
        const mine = setup;
        let r = null;
        try { r = await h.connect(p.name, p.security === 'open' ? undefined : p.key); } catch (err) { r = { error: String((err && err.message) || err) }; }
        if (!setup || setup !== mine || !c.modal.isConnected) return;
        if (r && r.error) {
            await message(r.error, W.title, 'error');
            c.reset('wlanpref:10101');
            return;
        }
        if (typeof h.autoConnect === 'function') Promise.resolve(h.autoConnect(p.name, !!p.auto)).catch(() => {});
        remember(p.name, p.security === 'open' ? 'open' : 'psk', !!p.auto);
        c.go('wlanpref:10104');
    }

    /** How do you want to connect?: the options this computer can use, and with the check box the others, greyed. */
    function howLayout(c) {
        const more = !!c.get(1301, 'connect:503');
        const wifi = available();
        cmdText(c, 1401, 'connect:503', 'Wireless', 'Connect using a wireless router or a wireless network.');
        cmdText(c, 1402, 'connect:503', 'Broadband (PPPoE)', 'Connect using DSL or cable that requires a user name and password.');
        cmdText(c, 1403, 'connect:503', 'Dial-up', 'Connect using a dial-up modem or ISDN.');
        // the options this computer can use, and with the check box the others, greyed
        const shown = [[1401, wifi], [1402, false], [1403, false]].filter(([, on]) => on || more);
        [1401, 1402, 1403].forEach((id) => c.show(id, false, 'connect:503'));
        shown.forEach(([id, on], i) => {
            const h = c.holder(id, 'connect:503');
            if (!h) return;
            h.hidden = false;
            h.style.top = `${Math.round((3 + i * 40) * 15 / 8)}px`;
            c.enable(id, on, 'connect:503');
        });
        pageInstruction(c, 'connect:503', shown.length ? W.how : W.noHardware);
    }

    async function openSetup() {
        if (setup && setup.ctx && live(setup.ctx.modal)) { call('bringModalToFront', setup.ctx.modal); return setup.ctx.modal; }
        const V = await kit();
        setup = { ctx: null, sel: 'internet', pending: null };
        const mine = setup;
        const progress = (computer, far) => ({ 1701: { image: `${NET}/${computer}.png` }, 1702: { image: `${NET}/setup-line-48.png` }, 1703: { image: `${NET}/${far}.png` } });
        const ctx = V.openWizard({
            id: 'dreamosNetSetup',
            title: W.title,
            icon: `${NET}/setup-connection-16.png`,
            pages: [
                {
                    key: 'connect:305',
                    instruction: W.choose,
                    overrides: { 1051: { skip: true }, 2101: { html: setupListHtml(), cls: 'dwf-sw-holder' } },
                    show: (c) => { footer(c, { firstPage: true }); setupTitle(c, W.title); },
                    next: (c) => {
                        const id = setup.sel;
                        if (id === 'internet') {
                            if (online()) return 'connect:103';
                            if (firstLan()) { runTest(c); return 'connect:107'; }
                            return 'connect:503';
                        }
                        if (id === 'wireless') return 'wlanpref:10101';
                        if (id === 'workplace') {
                            // Vista's Connect to a workplace (#952, dreamosVpn.js): its own wizard window, as on the VM
                            const owner = c.modal;
                            void vpnLib().then((lib) => { if (lib) { c.close(); void lib.openWizard(owner); } });
                            return false;
                        }
                        // a wireless router, an ad hoc network, a dial-up modem: hardware Melaton does not have
                        return 'connect:701';
                    }
                },
                {
                    key: 'connect:103',
                    instruction: W.already,
                    noNext: true,
                    overrides: progress('setup-computer-48', 'setup-globe-48'),
                    show: (c) => { footer(c); setupTitle(c, W.internet); pageInstruction(c, 'connect:103', online() ? W.already : W.connected); }
                },
                {
                    key: 'connect:503',
                    instruction: W.how,
                    noNext: true,
                    overrides: { 2101: { skip: true }, 1501: { skip: true } },
                    show: (c) => { footer(c); setupTitle(c, W.internet); howLayout(c); }
                },
                {
                    key: 'connect:107',
                    instruction: W.testing,
                    noNext: true,
                    noBack: true,
                    transient: true,
                    overrides: { ...progress('setup-computer-48', 'setup-globe-48') },
                    show: (c) => {
                        footer(c, { noBack: true });
                        setupTitle(c, W.internet);
                        const bar = c.holder(2502, 'connect:107');
                        if (bar) bar.classList.add('marquee');
                    }
                },
                {
                    key: 'connect:109',
                    instruction: W.failed,
                    noNext: true,
                    overrides: progress('setup-computer-48', 'setup-globe-off-48'),
                    show: (c) => { footer(c); setupTitle(c, W.internet); }
                },
                {
                    key: 'connect:701',
                    instruction: W.cannot,
                    noNext: true,
                    overrides: { 1051: { skip: true }, 1053: { html: `<div class="vdt-edge dwf-sw-details">${esc(W.noDetails)}</div>`, hidden: true } },
                    show: (c) => { footer(c); }
                },
                {
                    key: 'wlanpref:10101',
                    instruction: W.enter,
                    // one profile type (all users): the radios and their shield go, the rest moves up into their place
                    overrides: { 10335: { skip: true }, 10336: { skip: true }, 10337: { skip: true }, 10328: { nudge: [0, -54, 0, 0] }, 10334: { nudge: [0, -54, 0, 0], disabled: true }, 10339: { nudge: [0, -54, 0, 0] } },
                    show: (c) => { footer(c); setupTitle(c, W.manual); },
                    next: async (c) => {
                        const k = 'wlanpref:10101';
                        const name = String(c.get(10303, k) || '');
                        if (!name) { await message(W.nameEmpty, W.badName, 'error'); return false; }
                        if (name.length > 32) { await message(fill(W.nameLong, name), W.badName, 'error'); return false; }
                        const sec = String(c.get(10305, k) || 'wpa2');
                        const key = String(c.get(10304, k) || '');
                        if (sec !== 'open') {
                            const hex64 = /^[0-9a-f]{64}$/i.test(key);
                            // eslint-disable-next-line no-control-regex
                            if (!hex64 && (key.length < 8 || key.length > 63 || /[^\x20-\x7e]/.test(key))) { await message(sec === 'wpa' ? W.keyRuleWpa : W.keyRule, W.badKey, 'error'); return false; }
                        }
                        setup.pending = { name, security: sec, key, auto: !!c.get(10328, k) };
                        root.setTimeout(() => runAdd(c), 0);
                        return 'wlanpref:10103';
                    }
                },
                {
                    key: 'wlanpref:10103',
                    instruction: W.adding,
                    noNext: true,
                    noBack: true,
                    transient: true,
                    overrides: { '-1': { image: `${NET}/wlanconn-computer-48.png` } },
                    show: (c) => {
                        footer(c, { noBack: true });
                        pageInstruction(c, 'wlanpref:10103', fill(W.adding, setup.pending ? setup.pending.name : ''));
                        // the three pictures have no ids: the computer, the line, the network, in template order
                        const pics = c.page('wlanpref:10103').querySelectorAll('.vdt-image img');
                        ['wlanconn-computer-48', 'wlanconn-line-214', 'wlanconn-network-48'].forEach((n, i) => { if (pics[i]) pics[i].src = `${NET}/${n}.png`; });
                        if (pics[1]) pics[1].closest('.vdt-image').classList.add('dwf-line');
                        const bar = c.holder(10301, 'wlanpref:10103');
                        if (bar) bar.classList.add('marquee');
                    }
                },
                {
                    key: 'wlanpref:10104',
                    instruction: W.added,
                    finish: true,
                    noBack: true,
                    show: (c) => {
                        footer(c, { cancel: false, nextText: S.close, noBack: true });
                        pageInstruction(c, 'wlanpref:10104', fill(W.added, setup.pending ? setup.pending.name : ''));
                    }
                }
            ],
            init: (c) => {
                // the option list (connect 305's list view): one click selects, a double-click is Next
                c.on(2101, 'click', (ev) => {
                    const row = ev.target.closest('.dwf-sw-row');
                    if (!row) return;
                    setup.sel = row.dataset.key;
                    row.parentElement.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
                    row.classList.add('is-selected');
                }, 'connect:305');
                c.on(2101, 'dblclick', (ev) => { if (ev.target.closest('.dwf-sw-row')) c.content.querySelector('.vdt-wizard-next').click(); }, 'connect:305');
                c.on(2101, 'keydown', (ev) => {
                    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
                    ev.preventDefault();
                    const list = setupList();
                    const i = Math.max(0, Math.min(list.length - 1, list.findIndex((o) => o.id === setup.sel) + (ev.key === 'ArrowDown' ? 1 : -1)));
                    setup.sel = list[i].id;
                    c.holder(2101, 'connect:305').querySelectorAll('.dwf-sw-row').forEach((n) => n.classList.toggle('is-selected', n.dataset.key === setup.sel));
                }, 'connect:305');
                // already connected: Browse the Internet now / Set up a new connection anyway
                c.on(1401, 'click', () => { c.close(); const it = call('findStartMenuLaunchableById', 'alchemy'); if (it) call('launchStartMenuItem', it); }, 'connect:103');
                c.on(1402, 'click', () => c.go('connect:503'), 'connect:103');
                // How do you want to connect?: Wireless hands over to Connect to a network
                c.on(1401, 'click', () => { c.close(); void openConnect(); }, 'connect:503');
                c.on(1301, 'change', () => howLayout(c), 'connect:503');
                // the test failed: Try again / Diagnose the problem / Set up the connection anyway
                c.on(1401, 'click', () => { runTest(c); c.go('connect:107'); }, 'connect:109');
                c.on(1402, 'click', () => { const a = firstLan(); if (a) void diagnoseAdapter(a).then(() => ipv4Properties(a, c.modal)); }, 'connect:109');
                c.on(1403, 'click', () => {
                    // a wired network that needs fixed settings: its TCP/IPv4 Properties, where Vista sets them
                    const a = firstLan();
                    if (a) void ipv4Properties(a, c.modal); else c.go('connect:503');
                }, 'connect:109');
                c.on(1301, 'change', () => c.show(1053, !!c.get(1301, 'connect:701'), 'connect:701'), 'connect:701');
                // Manually connect: the security types and the cipher each allows, Display characters
                const k = 'wlanpref:10101';
                c.options(10305, SECURITY.map((x) => ({ value: x.value, text: x.text })), 'wpa2', k);
                const ciphers = () => {
                    const sec = SECURITY.find((x) => x.value === c.get(10305, k)) || SECURITY[2];
                    c.options(10306, sec.ciphers, sec.ciphers[0], k);
                    const open = sec.value === 'open';
                    c.enable(10304, !open, k);
                    c.enable(10307, !open, k);
                    if (open) c.set(10304, '', k);
                };
                ciphers();
                c.on(10305, 'change', ciphers, k);
                c.on(10307, 'change', () => { const e = c.el(10304, k); if (e) e.type = c.get(10307, k) ? 'text' : 'password'; }, k);
                c.set(10328, true, k);
                c.on(10313, 'click', () => { c.close(); void openConnect(); }, 'wlanpref:10104');
                c.on(10314, 'click', () => { const p = setup && setup.pending; if (p) void networkProperties(p.name, c.modal); }, 'wlanpref:10104');
            },
            finish: () => true,
            close: () => { if (setup === mine) setup = null; }
        });
        if (!ctx) { setup = null; return null; }
        setup.ctx = ctx;
        return ctx.modal;
    }

    // ---- the host's pushes ------------------------------------------------------------------------------------------

    function onNet() {
        noteConnection();
        vanPaint();
        statusWins.forEach((st) => statusPaint(st));
        mwnRerender();
        // Network Connections on screen: its adapters' enabled state is the host's list (interfaces())
        const cp = root.melatonControlPanel;
        if (cp && typeof cp.currentPage === 'function' && cp.currentPage() === NC) void readIfaces().then(ncRerender);
    }

    // the Android app's fresh read of the real interfaces (DSApp NetIfaces, 'androidnetifaces', #945): only while
    // Network Connections or a status sheet is on screen is the list read again (the push itself is rare: a read
    // that differs from the last)
    if (root.addEventListener) {
        root.addEventListener('androidnetifaces', () => {
            const cp = root.melatonControlPanel;
            const ncOn = !!(cp && typeof cp.currentPage === 'function' && cp.currentPage() === NC);
            if (!ncOn && !statusWins.size) return;
            void readIfaces().then(() => {
                if (ncOn) ncRerender();
                statusWins.forEach((st) => statusPaint(st));
            });
        }, { signal: appScopeSignal });
    }

    // the provider's pushes: its state, and a finished scan's list (provider.onScan); a provider registered later is
    // followed too
    let scanOff = null;
    const onScanList = (d) => {
        setList(d && Array.isArray(d.networks) ? d.networks : null);
        vanPaint();
        mwnRerender();
    };
    const followScan = () => {
        if (scanOff) { try { scanOff(); } catch (_) { /* gone */ } scanOff = null; }
        const h = host();
        if (h && typeof h.onScan === 'function') scanOff = h.onScan(onScanList);
    };
    if (root.melatonTray) {
        let last = host();
        const off = root.melatonTray.onChange('network', () => { if (host() !== last) { last = host(); followScan(); } onNet(); });
        if (appScopeSignal) appScopeSignal.addEventListener('abort', () => { off(); if (scanOff) scanOff(); }, { once: true });
        followScan();
    }
    root.addEventListener('nightshade:state', vanPaint, { signal: appScopeSignal });
    // (#952) a workplace connection made, renamed, changed or deleted (dreamosVpn.js), the Nightshade link up or down
    // (a connection to this server follows it), the adapter's lease: an open Network Connections draws it
    root.addEventListener('dreamos-vpn-changed', () => { ncRerender(); vanPaint(); }, { signal: appScopeSignal });
    root.addEventListener('nightshade:state', () => ncRerender(), { signal: appScopeSignal });
    root.addEventListener('melaton-nightshade-lease', () => ncRerender(), { signal: appScopeSignal });
    noteConnection();

    root.dreamosWifi = {
        openConnect, openManage, openStatus: () => openStatus(), openVpnStatus, available, signalLevel,
        /** the Mobile Broadband Connection's status sheet (null without a mobile adapter) */
        // (#952) a connection's name in Network Connections: the modem's data interface ("Local Area Connection 2"), Wi-Fi
        connectionOf: (kind) => { const list = adapters(); const a = (kind === 'mobile' && list.find((x) => x.kind === 'mobile' && x.row && x.row.alias === 'rmnet0')) || list.find((x) => x.kind === kind); return a ? a.conn : ''; },
        openMobileStatus: () => { const list = adapters(); const m = list.find((x) => x.kind === 'mobile' && x.row && x.row.alias === 'rmnet0') || list.find((x) => x.kind === 'mobile'); return m ? openStatus(m) : Promise.resolve(null); },
        openConnections, openSetup, setRadio,
        /** the Wi-Fi adapter is there but switched off (the flyout offers to turn it on) */
        radioOff: () => { const w = state().wifi || {}; return !!(host() && w.present && (w.radio === false || w.state === 'off')); },
        _manageBody: mwnBody,
        _connectionsBody: () => { const html = ncBody(); nc.html = html; return html; }
    };
})(typeof window !== 'undefined' ? window : globalThis);
