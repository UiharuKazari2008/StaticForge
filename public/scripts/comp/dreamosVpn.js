/**
 * Vista's VPN connections (Yozora #952, Yukimi Nov 20 2026: "Did we do any work on VPN connections?"), loaded on demand
 * (featureLoader 'network_vpn') by dreamosWifi.js. Every piece is the VM's own (rasdlg.dll.mui / netshell.dll.mui /
 * connect.dll.mui templates; the Connect to a workplace pages, which Vista draws without a dialog template, measured
 * off the VM at its Segoe UI 9 units):
 *
 *   Connect to a workplace     Set up a connection or network > Connect to a workplace: How do you want to connect?
 *                              (Use my Internet connection (VPN) / Dial directly), Type the Internet address to connect
 *                              to, Type your user name and password, The connection is ready to use (connect.dll 299)
 *   VPN connection objects     kept on this computer (localStorage dreamos.ncpa.vpn, as Vista keeps its phone book;
 *                              never a password), shown by Network Connections in Virtual Private Network on
 *                              "WAN Miniport (L2TP)" / "WAN Miniport (PPTP)"
 *   Connect <name>             rasdlg 117: User name, Password, Domain, Save this user name and password ..., Connect /
 *                              Cancel / Properties / Help; Connecting <name>... (rasdlg 113) and Error Connecting to
 *                              <name> (rasdlg 111, Redial = 60 counting down, Close, Diagnose)
 *   <name> Properties          General (rasdlg 1425), Options (1426), Security (164), Networking (158), Sharing
 *                              (netshell 10751)
 *
 * What a connection reaches, honestly: one whose host is this server (its FQDN, the address the page came from, or the
 * domain) is the Nightshade Network, and connecting it connects the Nightshade link; a VPN app's tunnel on the phone
 * (tun0: WireGuard ...) is its own connection in Network Connections, switched through the app (AndroidWifi.vpnControl);
 * any other host is a PPTP / L2TP server a browser cannot dial, and Connect ends as the VM's does when the server does
 * not answer: Error 800.
 *
 *   window.dreamosVpn = { list(), get(id), openWizard(), openConnect(id), openProperties(id, owner), remove(id),
 *                         rename(id, name), isNightshade(o), device(o) }
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'dreamos.ncpa.vpn';
    const NET = '/static_images/vista-net';
    const SHIELD = '/static_images/vista-cpl/shield-uac-16.png';

    // the templates (DLGTEMPLATEEX from the VM, vistaDialogTemplates' format); the workplace pages are measured
    const TPL = {
        "rasdlg:117": {"t":"Connect %1","w":228,"h":229,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[1100,"S",8,6,219,85,1342177294,"#1678",0],[1413,"S",10,102,50,8,1342308352,"&User name:",0],[1104,"E",62,99,154,14,1350631552,"",0],[1112,"S",10,120,50,8,1342308352,"&Password:",0],[1103,"E",62,117,154,14,1350631584,"",0],[1110,"S",10,138,50,8,1342308352,"Do&main:",0],[1102,"E",62,135,154,14,1350631560,"",0],[-1,"S",7,155,214,1,1342181388,"",0],[1101,"B",10,159,203,13,1342383363,"&Save this user name and password for the following users:",0],[1622,"B",21,175,193,11,1342383369,"Me o&nly",0],[1623,"B",21,187,193,11,1342252297,"&Anyone who uses this computer",0],[1638,"S",10,187,10,10,1342177283,"",0],[-1,"S",7,202,214,1,1342312460,"",0],[1590,"B",8,208,50,14,1342373889,"&Dial",0],[1591,"B",62,208,50,14,1342242816,"Cancel",0],[1107,"B",116,208,50,14,1342242816,"Pr&operties",0],[1592,"B",170,208,50,14,1342242816,"&Help",0]]},
        "rasdlg:1425": {"t":"General","w":227,"h":215,"f":["MS Shell Dlg",8],"s":2160066752,"c":[[1430,"S",7,7,214,18,1342308352,"&Host name or IP address of destination (such as microsoft.com or 157.54.0.1 or 3ffe:1234::1111):",0],[1427,"E",7,28,213,14,1350631552,"",0],[1431,"B",7,50,213,78,1342177287,"First connect",0],[1432,"S",17,63,193,24,1342308352,"Windows can first connect to a public network, such as the Internet, before trying to establish this virtual connection.",0],[1428,"B",17,94,183,10,1342242819,"&Dial another connection first:",0],[1429,"C",29,106,182,87,1344340227,"",0]]},
        "rasdlg:1426": {"t":"Options","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086324808,"c":[[1289,"B",7,7,213,75,1342177287,"Dialing options",0],[1284,"B",16,17,200,10,1342242819,"&Display progress while connecting",0],[1554,"B",16,29,200,10,1342242819,"&Prompt for name and password, certificate, etc.",0],[1555,"B",16,41,200,10,1342242819,"Include &Windows logon domain",0],[1748,"B",16,53,200,10,1342252035,"&Show icon in notification area when connected",0],[1744,"B",16,65,200,10,1342252035,"&Keep this connection connected when switching users",0],[1290,"B",7,87,213,92,1342177287,"Redialing options",0],[1300,"S",16,102,115,8,1342308352,"&Redial attempts:",0],[1287,"E",141,99,69,14,1350639744,"",0],[1301,"S",16,117,115,8,1342308352,"&Time between redial attempts:",0],[1292,"C",141,114,70,123,1344339971,"",0],[1299,"S",16,132,115,8,1342308352,"Idle ti&me before hanging up:",0],[1291,"C",141,129,70,108,1344339971,"",0],[1738,"S",16,147,115,8,1342308352,"Idl&e threshold:",0],[1739,"C",141,144,70,108,1344339971,"",0],[1286,"B",16,162,199,10,1342252035,"Redial if &line is dropped",0],[1419,"B",7,192,60,14,1342242816,"PPP Settin&gs...",0]]},
        "rasdlg:164": {"t":"Security","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086324800,"c":[[1580,"B",7,6,213,157,1342177287,"Security options",0],[1540,"B",14,16,197,8,1342373897,"&Typical (recommended settings)",0],[1541,"B",14,102,197,8,1342259209,"A&dvanced (custom settings)",0],[1537,"S",26,29,183,8,1342177280,"&Verify my identity as follows:",0],[1178,"C",26,40,180,78,1344340035,"",0],[1174,"B",26,58,180,20,1342252035,"A&utomatically use my Windows logon name and password (and domain, if any)",0],[1169,"B",26,82,180,10,1342252035,"Requ&ire data encryption (disconnect if none)",0],[1539,"S",26,114,136,20,1342308352,"Using these settings requires a knowledge of security protocols.",0],[1180,"B",165,115,46,14,1342242816,"&Settings...",0],[1759,"SysLink",14,134,197,24,1342242818,"See our online <A HREF=\"http://go.microsoft.com/fwlink/?LinkId=34493\">privacy statement</A> for data collection and use information.",0]]},
        "rasdlg:158": {"t":"Networking","w":227,"h":215,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[1583,"S",7,3,213,8,1342308352,"Typ&e of VPN:",0],[1418,"C",7,13,213,46,1344339971,"",0],[1598,"B",151,28,69,14,1342242816,"I&Psec Settings...",0],[1684,"S",8,45,213,10,1342308352,"This c&onnection uses the following items:",0],[1251,"SysListView32",7,56,213,84,1350681613,"",0],[1252,"B",7,145,67,14,1342242816,"I&nstall...",0],[1254,"B",80,145,67,14,1342242816,"&Uninstall",0],[1253,"B",153,145,67,14,1342242816,"P&roperties",0],[1585,"B",7,163,213,43,1342177287,"Description",0],[1250,"S",16,175,195,25,1342308352,"",0]]},
        "netshell:10751": {"t":"Sharing","w":227,"h":189,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[103,"B",7,8,213,97,1342177287,"Internet Connection Sharing",0],[104,"B",7,8,213,117,1073741831,"Internet Connection Sharing",0],[115,"B",7,8,213,52,1073741831,"Internet Connection Sharing",0],[105,"B",14,24,194,16,1342252035,"Allow other &network users to connect through this computer's Internet connection",0],[106,"S",26,47,189,8,1208090624,"&Home networking connection:",0],[107,"C",26,58,189,50,1075904515,"",0],[108,"E",26,58,189,12,1073809536,"",512],[109,"B",14,58,188,16,1342252035,"All&ow other network users to control or disable the shared Internet connection",0],[110,"S",15,78,194,1,1207959568,"",0],[111,"SysLink",15,82,138,20,1342242816,"<A>Using ICS (Internet Connection Sharing)</A>",0],[112,"B",164,82,50,14,1342242816,"Settin&gs...",0]]},
        "netshell:24100": {"t":"General","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[23501,"S",17,21,100,8,1342308352,"IPv4 Connectivity:",0],[23502,"S",110,21,100,8,1342308352,"None",4096],[23503,"S",17,33,100,8,1342308352,"IPv6 Connectivity:",0],[23504,"S",110,33,100,8,1342308352,"None",4096],[1032,"S",17,45,100,8,1342308352,"Media State:",0],[1007,"S",73,45,137,8,1342308352,"Disconnected",4096],[1033,"S",17,57,100,8,1342308352,"Duration:",0],[1008,"S",73,57,137,8,1342308352,"00:00:00",4096],[1034,"S",17,69,100,8,1342308352,"Speed:",0],[1009,"S",73,69,137,8,1342308352,"0 bps",4096],[23506,"B",17,83,50,14,1342242816,"D&etails...",0],[1035,"S",54,127,41,8,1342308352,"Sent",4096],[1030,"S",99,131,13,1,1342177288,"",0],[1010,"S",121,120,21,20,1342177283,"#210",0],[1031,"S",156,131,13,1,1342177288,"",0],[1036,"S",174,127,35,8,1342308352,"Received",4096],[1023,"S",17,149,34,8,1342308352,"Bytes:",0],[1003,"S",52,149,63,8,1342308352,"0",4096],[1028,"S",134,149,1,30,1342177288,"",0],[1029,"S",134,149,1,10,1342177288,"",0],[1005,"S",149,149,61,8,1342308352,"0",4096],[1037,"S",17,161,43,8,1342308352,"Compression:",0],[1004,"S",73,161,42,8,1342308352,"0 %",4096],[1006,"S",168,161,42,8,1342308352,"0 %",4096],[1027,"S",17,172,32,8,1342308352,"Errors:",0],[1012,"S",69,172,46,8,1342308352,"0",4096],[1013,"S",164,172,46,8,1342308352,"0",4096],[-1,"S",7,106,25,8,1342308352,"Activity",0],[-1,"S",35,110,184,1,1342177296,"",0],[-1,"S",7,9,37,8,1342308352,"Connection",0],[-1,"S",50,13,170,1,1342177296,"",0],[1026,"B",7,192,55,14,1342242816,"&Properties",0],[1025,"B",65,192,55,14,1342242816,"&Disable",0],[23505,"B",123,192,55,14,1342242816,"Dia&gnose",0]]},
        "netshell:24200": {"t":"Details","w":227,"h":215,"f":["MS Shell Dlg",8],"s":1086849096,"c":[[24202,"B",162,131,50,14,1342242816,"&Suspend",0],[24206,"C",16,111,196,45,1344340227,"",0],[24203,"S",17,134,85,8,1342308352,"Number of active devices:",0],[24204,"S",110,134,20,8,1342308352,"0",0],[24205,"SysListView32",7,7,213,77,1350631425,"List1",0],[24201,"S",9,99,26,8,1342308352,"Devices",0],[24207,"S",47,102,172,1,1342177296,"",0]]},
        "connect:299": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1701,"S",60,10,48,48,1342179331,"#11100",0],[1702,"S",88,10,118,48,1342179331,"#11103",0],[1703,"S",210,10,48,48,1342179331,"#11104",0],[1704,"S",210,10,48,48,1342179331,"#11105",0],[1401,"B",30,55,235,23,1342242830,"&Try again",0],[1402,"B",30,81,235,23,1342242830,"&Diagnose the problem",0],[1403,"B",30,107,235,32,1342242830,"&Set up the connection anyway",0],[1404,"B",30,75,235,23,1342242830,"Connect &now",0],[1051,"S",30,75,220,50,1342308352,"You need to set up an Internet connection before you can connect.",0]]},
        "rasdlg:113": {"t":"Connecting %1...","w":217,"h":60,"f":["MS Shell Dlg",8],"s":2428502208,"c":[[1417,"S",7,7,20,20,1342177283,"#563",0],[1097,"S",39,7,171,32,1342308480,"",0],[2,"B",84,39,50,14,1342242816,"Cancel",0]]},
        "rasdlg:111": {"t":"Error Connecting to %1","w":281,"h":228,"f":["MS Shell Dlg",8],"s":2429026496,"c":[[1068,"S",7,7,20,20,1342308355,"#32515",0],[1070,"S",40,10,216,92,1342308352,"",0],[1,"B",29,200,104,14,1342373889,"Do not dial=88",0],[2,"B",135,200,54,14,1342242816,"&Close",0],[1069,"B",209,200,54,14,1342242816,"&Diagnose",0],[1712,"B",28,134,62,10,1342242819,"&Enable logging",0],[1638,"S",14,134,10,10,1342177283,"",0],[1716,"SysLink",38,144,143,14,1342242816,"For logging options, see <A>diagnostics</A>",0],[1735,"S",28,108,225,20,1342308352,"If you continue to receive error messages, you can enable logging for analysis.",0],[1736,"S",38,162,232,31,1342308352,"Logging options can also be accessed by clicking the Remote Access Preferences menu item under the Advanced menu of the Network Connection Folder.",0]]},
        "rasdlg:502": {"t":"PPP Settings","w":212,"h":68,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[1423,"B",7,7,198,10,1342252035,"&Enable LCP extensions",0],[1424,"B",7,20,198,10,1342252035,"E&nable software compression",0],[1557,"B",7,33,198,10,1342252035,"Negotiate &multi-link for single-link connections",0],[1,"B",99,49,50,14,1342242817,"OK",0],[2,"B",155,49,50,14,1342242816,"Cancel",0]]},
        "rasdlg:570": {"t":"IPsec Settings","w":246,"h":97,"f":["MS Shell Dlg",8],"s":2160591040,"c":[[1,"B",132,77,50,14,1342242817,"OK",0],[2,"B",187,77,50,14,1342242816,"Cancel",0],[1602,"S",20,22,30,12,1342308352,"&Key:",0],[1605,"E",42,21,172,12,1350631552,"",0],[1604,"B",8,8,206,8,1342177289,"Use &preshared key for authentication",0],[1775,"B",8,40,206,8,1342177289,"Use &certificate for authentication",0],[1776,"B",19,54,220,17,1342252035,"&Verify the Name and Usage attributes of the server’s certificate",0]]},
        "rasdlg:105": {"t":"Advanced Security Settings","w":245,"h":233,"f":["MS Shell Dlg",8],"s":2160591048,"c":[[1547,"B",7,38,231,165,1342177287,"Logon security",0],[1546,"S",7,7,229,10,1342308352,"&Data encryption:",0],[1495,"C",7,17,231,76,1344339971,"",0],[1544,"B",14,50,207,8,1342373897,"Use &Extensible Authentication Protocol (EAP)",0],[1545,"B",14,94,173,10,1342242825,"Allow these &protocols",0],[1034,"C",24,62,201,42,1344340227,"",0],[1035,"B",175,77,50,14,1342242816,"P&roperties",0],[1491,"B",28,108,200,10,1342383107,"&Unencrypted password (PAP)",0],[1494,"B",28,122,200,10,1342252035,"&Challenge Handshake Authentication Protocol (CHAP)",0],[1492,"B",28,136,200,10,1342252035,"M&icrosoft CHAP Version 2 (MS-CHAP v2)",0],[1549,"B",40,150,188,19,1342252035,"&Automatically use my Windows logon name and password (and domain, if any)",0],[1752,"B",15,178,213,20,1342252035,"&When connected, prevent sharing of this connection with other users on this computer",0],[1,"B",131,210,50,14,1342242817,"OK",0],[2,"B",186,210,50,14,1342242816,"Cancel",0]]},
        // Connect to a workplace's pages, measured on the VM (Segoe UI 9: x * 7/4, y * 15/8 from the page's corner)
        "dsvpn:how": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1401,"B",2,1,298,33,1342242830,"Use my &Internet connection (VPN)\nConnect using a virtual private network (VPN) connection through the Internet.",0],[1711,"S",15,38,27,26,1342179331,"",0],[1712,"S",55,51,33,1,1342177280,"",0],[1713,"S",98,38,27,26,1342179331,"",0],[1714,"S",138,51,33,1,1342177280,"",0],[1715,"S",180,38,29,26,1342179331,"",0],[1402,"B",2,69,298,33,1342242830,"&Dial directly\nConnect directly to a phone number without going through the Internet.",0],[1721,"S",15,102,27,26,1342179331,"",0],[1722,"S",55,115,33,1,1342177280,"",0],[1725,"S",98,102,29,26,1342179331,"",0],[1501,"SysLink",1,135,120,10,1342242816,"<A>What is a VPN connection?</A>",0]]},
        "dsvpn:addr": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1051,"S",1,3,290,9,1342308352,"Your network administrator can give you this address.",0],[1061,"S",1,23,80,9,1342308352,"&Internet address:",0],[1062,"E",89,20,174,13,1350631552,"",0],[1063,"S",1,42,80,9,1342308352,"D&estination name:",0],[1064,"E",89,39,174,13,1350631552,"",0],[1065,"B",15,77,200,10,1342242819,"Use a &smart card",0],[1066,"S",3,92,9,9,1342179331,"",0],[1067,"B",15,90,250,10,1342242819,"&Allow other people to use this connection",0],[1068,"S",24,102,270,9,1342308352,"This option allows anyone with access to this computer to use this connection.",0],[1069,"B",15,114,270,10,1342242819,"&Don't connect now; just set it up so I can connect later",0]]},
        "dsvpn:user": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1071,"S",1,6,80,9,1342308352,"&User name:",0],[1072,"E",91,2,133,13,1350631552,"",0],[1073,"S",1,26,80,9,1342308352,"&Password:",0],[1074,"E",91,22,133,13,1350631584,"",0],[1075,"B",91,39,130,10,1342242819,"&Show characters",0],[1076,"B",91,51,130,10,1342242819,"&Remember this password",0],[1077,"S",0,69,85,9,1342308352,"D&omain (optional):",0],[1078,"E",91,64,133,13,1350631552,"",0]]},
        "dsvpn:dial": {"t":"","w":317,"h":143,"f":["Segoe UI",9],"s":1220542528,"c":[[1051,"S",1,3,300,30,1342308352,"Melaton has no modem or ISDN adapter to dial with. A workplace connection reaches the network through the Internet (VPN).",0]]}
    };

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : null);

    // ---- the connections (this computer's phone book) ------------------------------------------------------------

    // (#952) the phone book is this computer's on the server: Melaton's registry (per user), under the computer (the
    // phone's ActiveSync device id, else this browser's Nightshade adapter address), one value "Vpn <id>" per
    // connection (JSON); this browser's own list from before moves there once
    const REG_BASE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Network\\Connections';
    function computerKey() {
        try {
            const A = root.AndroidActiveSync;
            const id = A && typeof A.getDeviceId === 'function' ? String(A.getDeviceId() || '').toLowerCase().replace(/[^0-9a-z-]/g, '') : '';
            if (id) return id.slice(0, 64);
        } catch (_) { /* below */ }
        const d = root.melatonNetworkDialogs;
        try { const nic = d && typeof d.nightshadeNic === 'function' ? d.nightshadeNic() : ''; if (nic) return `nic-${nic}`; } catch (_) { /* below */ }
        return 'local';
    }
    const regKey = () => `${REG_BASE}\\${computerKey()}`;
    const reg = () => (root.melatonRegistry && typeof root.melatonRegistry.getKey === 'function' ? root.melatonRegistry : null);
    function localList() {
        try { const v = JSON.parse(root.localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((o) => o && o.id && o.name) : []; } catch (_) { return []; }
    }
    function list() {
        const R = reg();
        if (!R) return localList();
        const vals = R.getKey(regKey()) || {};
        const old = localList();
        if (old.length) {
            // moved once: what the registry does not have yet
            const patch = {};
            old.forEach((o) => { if (!vals[`Vpn ${o.id}`]) patch[`Vpn ${o.id}`] = JSON.stringify(o).slice(0, 4096); });
            if (Object.keys(patch).length) void R.set(regKey(), patch);
            try { root.localStorage.removeItem(KEY); } catch (_) { /* private window */ }
            Object.assign(vals, patch);
        }
        return Object.keys(vals).filter((k) => k.startsWith('Vpn ')).map((k) => { try { return JSON.parse(vals[k]); } catch (_) { return null; } })
            .filter((o) => o && o.id && o.name).sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
    }
    function save(rows) {
        const R = reg();
        if (R) {
            const vals = R.getKey(regKey()) || {};
            const keep = new Set(rows.map((o) => `Vpn ${o.id}`));
            const patch = {};
            rows.forEach((o) => { patch[`Vpn ${o.id}`] = JSON.stringify(o).slice(0, 4096); });
            Object.keys(vals).forEach((k) => { if (k.startsWith('Vpn ') && !keep.has(k)) patch[k] = null; });
            void R.set(regKey(), patch);
        } else {
            try { root.localStorage.setItem(KEY, JSON.stringify(rows)); } catch (_) { /* private window: this page's own */ }
        }
        try { root.dispatchEvent(new CustomEvent('dreamos-vpn-changed')); } catch (_) { /* old engine */ }
    }
    const get = (id) => list().find((o) => o.id === id) || null;
    function update(id, patch) {
        const rows = list();
        const i = rows.findIndex((o) => o.id === id);
        if (i < 0) return null;
        rows[i] = { ...rows[i], ...patch };
        save(rows);
        return rows[i];
    }
    function remove(id) { save(list().filter((o) => o.id !== id)); }
    function rename(id, name) { return update(id, { name: String(name || '').slice(0, 256) }); }

    /** Vista names a new one "VPN Connection", then "VPN Connection 2" ... */
    function freeName(base = 'VPN Connection') {
        const names = new Set(list().map((o) => o.name.toLowerCase()));
        if (!names.has(base.toLowerCase())) return base;
        for (let n = 2; n < 1000; n += 1) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
        return base;
    }

    /** The VPN's device: Automatic and L2TP show the L2TP miniport, as the VM's VPN Connection does. */
    const device = (o) => (o && o.type === 'pptp' ? 'WAN Miniport (PPTP)' : 'WAN Miniport (L2TP)');

    /** A host that is this server: the lease's FQDN, the address this page came from, or the domain's name. */
    function isNightshade(o) {
        const h = String((o && o.host) || '').trim().toLowerCase().replace(/^\w+:\/\//, '').replace(/[/:].*$/, '');
        if (!h) return false;
        const d = root.melatonNetworkDialogs;
        let lease = null; let info = null;
        try { lease = d && d.nightshadeLease ? d.nightshadeLease() : null; info = d && d.connectionInfo ? d.connectionInfo() : null; } catch (_) { /* none */ }
        const mine = [lease && lease.domain, root.location && root.location.hostname, info && info.domain, lease && lease.gateway].filter(Boolean).map((x) => String(x).toLowerCase());
        return mine.includes(h);
    }

    function nightshadeUp() {
        const c = root.wsClient;
        try { const s = c && typeof c.nightshadeState === 'function' ? c.nightshadeState() : null; return !!(s && s.service === 'connected'); } catch (_) { return false; }
    }

    /** Connected now: a connection to this server is up while the Nightshade link is. */
    const connected = (o) => !!o && isNightshade(o) && nightshadeUp();

    // ---- the shared kit ---------------------------------------------------------------------------------------------

    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).then(() => {
            if (!root.vistaDialogTemplate) throw new Error('vistaDialogTemplate is not loaded');
            root.vistaDialogTemplates = root.vistaDialogTemplates || {};
            Object.assign(root.vistaDialogTemplates, TPL);
            return root.vistaDialogTemplate;
        });
    }

    function message(text, title, icon) {
        return Promise.resolve(call('showConfirmationDialog', esc(text).replace(/\n/g, '<br>'),
            [{ text: 'OK', value: true, className: 'btn-standard primary' }], null,
            { title, icon: icon === 'error' ? 'fas fa-circle-xmark' : icon === 'warning' ? 'fas fa-exclamation-triangle' : 'fas fa-info-circle', sound: true }));
    }

    // ---- Connect to a workplace ------------------------------------------------------------------------------------

    const WZ = {
        title: 'Connect to a workplace', // connect 3401
        how: 'How do you want to connect?',
        addr: 'Type the Internet address to connect to',
        user: 'Type your user name and password',
        ready: 'The connection is ready to use', // connect 3492
        dial: 'Dial directly',
        hint: '[Example:Contoso.com or 157.54.0.1 or 3ffe:1234::1111]'
    };
    let wz = null;

    function footer(c, { next = 'Next', cancel = 'Cancel', noNext = false, nextOn = true } = {}) {
        const n = c.content.querySelector('.vdt-wizard-next');
        if (n) { n.textContent = next; n.hidden = noNext; n.disabled = !nextOn; }
        const x = c.content.querySelector('.vdt-wizard-cancel');
        if (x) x.textContent = cancel;
        const back = c.modal.querySelector('.vdt-wizard-back');
        if (back) back.hidden = false;
    }

    async function openWizard(owner) {
        if (wz && wz.ctx && wz.ctx.modal.isConnected && !wz.ctx.modal.classList.contains('hidden')) { call('bringModalToFront', wz.ctx.modal); return wz.ctx.modal; }
        const V = await kit();
        wz = { ctx: null, made: null };
        const pic = (n) => ({ image: `${NET}/${n}.png` });
        const line = { html: '<span class="dsvpn-line"></span>', cls: 'dsvpn-line-holder' };
        const ctx = V.openWizard({
            id: 'dreamosVpnWizard',
            title: WZ.title,
            icon: `${NET}/setup-connection-16.png`,
            owner,
            pages: [
                {
                    key: 'dsvpn:how',
                    instruction: WZ.how,
                    noNext: true,
                    overrides: { 1711: pic('setup-computer-48'), 1712: line, 1713: pic('setup-globe-48'), 1714: line, 1715: pic('setup-workplace-48'), 1721: pic('setup-computer-48'), 1722: line, 1725: pic('setup-workplace-48') },
                    show: (c) => footer(c, { noNext: true })
                },
                {
                    key: 'dsvpn:addr',
                    instruction: WZ.addr,
                    overrides: { 1066: { image: SHIELD } },
                    show: (c) => {
                        footer(c, { nextOn: !!String(c.get(1062, 'dsvpn:addr') || '').trim() });
                        if (!c.get(1064, 'dsvpn:addr')) c.set(1064, freeName(), 'dsvpn:addr');
                    },
                    next: async (c) => {
                        const host = String(c.get(1062, 'dsvpn:addr') || '').trim();
                        const name = String(c.get(1064, 'dsvpn:addr') || '').trim() || freeName();
                        if (!host) return false;
                        if (/[\\/:*?<>|"\t]/.test(name.replace(/:/g, ''))) { await message('Cannot rename this connection. A connection name cannot contain tabs, only spaces, or any of the following characters: \\/:*?<>|"', 'Error Renaming Connection', 'error'); return false; }
                        wz.addr = { host, name, smartCard: !!c.get(1065, 'dsvpn:addr'), allUsers: !!c.get(1067, 'dsvpn:addr'), later: !!c.get(1069, 'dsvpn:addr') };
                        // a smart card needs no user name page (Vista goes straight to creating it)
                        return wz.addr.smartCard ? create(c) : 'dsvpn:user';
                    }
                },
                {
                    key: 'dsvpn:user',
                    instruction: WZ.user,
                    show: (c) => footer(c, { next: 'Create' }),
                    next: (c) => {
                        wz.user = { user: String(c.get(1072, 'dsvpn:user') || ''), password: String(c.get(1074, 'dsvpn:user') || ''), domain: String(c.get(1078, 'dsvpn:user') || '') };
                        return create(c);
                    }
                },
                {
                    key: 'dsvpn:dial',
                    instruction: WZ.dial,
                    noNext: true,
                    show: (c) => footer(c, { noNext: true })
                },
                {
                    key: 'connect:299',
                    instruction: WZ.ready,
                    noNext: true,
                    noBack: true,
                    overrides: { 1701: pic('setup-computer-48'), 1702: pic('setup-line-48'), 1703: { skip: true }, 1704: pic('setup-workplace-48'), 1401: { skip: true }, 1402: { skip: true }, 1403: { skip: true }, 1051: { skip: true }, 1404: { hidden: false } },
                    show: (c) => {
                        footer(c, { noNext: true, cancel: 'Close' });
                        const back = c.modal.querySelector('.vdt-wizard-back');
                        if (back) back.disabled = true;
                    }
                }
            ],
            init: (c) => {
                c.on(1401, 'click', () => c.go('dsvpn:addr'), 'dsvpn:how');
                c.on(1402, 'click', () => c.go('dsvpn:dial'), 'dsvpn:how');
                c.on(1501, 'click', () => call('openHelpAndSupport', 'vpn-connection'), 'dsvpn:how');
                const addr = c.el(1062, 'dsvpn:addr');
                if (addr) {
                    addr.placeholder = WZ.hint;
                    addr.addEventListener('input', () => { const n = c.content.querySelector('.vdt-wizard-next'); if (n) n.disabled = !addr.value.trim(); });
                }
                // Show characters: the password in plain text while it is ticked
                c.on(1075, 'change', () => { const p = c.el(1074, 'dsvpn:user'); if (p) p.type = c.get(1075, 'dsvpn:user') ? 'text' : 'password'; }, 'dsvpn:user');
                c.on(1404, 'click', () => { const id = wz && wz.made; c.close(); if (id) void openConnect(id); }, 'connect:299');
            }
        });
        if (!ctx) return null;
        wz.ctx = ctx;
        // the How page's command links carry Vista's green arrow (the kit draws them as command links)
        return ctx.modal;
    }

    /** Create: the connection goes into the phone book (never its password); then ready, or Connect at once. */
    function create(c) {
        const a = wz.addr || {};
        const u = wz.user || {};
        const o = {
            id: `vpn${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
            name: a.name || freeName(),
            host: a.host || '',
            type: 'auto',
            user: u.user || '',
            domain: u.domain || '',
            smartCard: !!a.smartCard,
            allUsers: !!a.allUsers,
            created: Date.now(),
            owner: (root.meletonAccounts && typeof root.meletonAccounts.name === 'function' ? root.meletonAccounts.name() : '') || '',
            options: { progress: true, prompt: true, includeDomain: true, redial: 3, interval: '1 minute', idle: 'never', redialDropped: true },
            security: { verify: a.smartCard ? 'smartcard' : 'secured', autoLogon: false, encrypt: true }
        };
        save(list().concat([o]));
        wz.made = o.id;
        if (u.password) session.set(o.id, u.password);
        if (!a.later) {
            root.setTimeout(() => { c.close(); void openConnect(o.id); }, 0);
            return false;
        }
        return 'connect:299';
    }

    // passwords live in this page only, for the Connect dialog while it is open (never stored)
    const session = new Map();

    // ---- Connect <name> (rasdlg 117), Connecting (113), Error Connecting (111) ----------------------------------------

    const RAS = {
        connect: 'Connect %1',
        connecting: 'Connecting to %1...',
        verifying: 'Verifying user name and password...', // rasdlg 428
        registering: 'Registering your computer on the network...', // 426
        error800: 'Error 800: Unable to establish the VPN connection.  The VPN server may be unreachable, or security parameters may not be configured properly for this connection.',
        errorTitle: 'Error Connecting to %1',
        redial: 'Redial = %1'
    };
    const fill = (t, a) => String(t).replace('%1', a);

    async function openConnect(id, owner) {
        const o = get(id);
        if (!o) return null;
        const V = await kit();
        const k = 'rasdlg:117';
        return V.openDialog({
            id: `dreamosVpnConnect-${o.id}`,
            key: k,
            title: fill(RAS.connect, o.name),
            owner,
            bareCaption: true,
            overrides: { 1638: { image: SHIELD }, 1590: { text: '&Connect' } },
            buttons: {
                1590: (c) => {
                    const user = String(c.get(1104) || '');
                    const pass = String(c.get(1103) || '');
                    update(o.id, { user, domain: String(c.get(1102) || ''), saveFor: c.get(1101) ? (c.get(1623) ? 'all' : 'me') : '' });
                    if (pass && c.get(1101)) session.set(o.id, pass);
                    c.close();
                    void dial(o.id, user);
                },
                1591: (c) => c.close(),
                1107: (c) => { void openProperties(o.id, c.modal); },
                1592: () => call('openHelpAndSupport', 'vpn-connection')
            },
            init: (c) => {
                c.set(1104, o.user || '');
                c.set(1103, session.get(o.id) || '');
                c.set(1102, o.domain || '');
                c.set(1101, !!o.saveFor);
                // the VM's radios are both empty while Save is off; ticking it picks Me only
                c.set(1622, o.saveFor === 'me');
                c.set(1623, o.saveFor === 'all');
                const sync = () => {
                    const on = !!c.get(1101);
                    c.enable(1622, on);
                    c.enable(1623, on);
                    if (on && !c.get(1622) && !c.get(1623)) c.set(1622, true);
                    if (!on) { c.set(1622, false); c.set(1623, false); }
                };
                c.on(1101, 'change', sync);
                sync();
                const first = c.el(o.user ? 1103 : 1104);
                if (first) root.requestAnimationFrame(() => { try { first.focus(); } catch (_) { /* gone */ } });
            }
        });
    }

    /** Dial: a connection to this server connects the Nightshade link; any other host cannot be dialled from here. */
    async function dial(id) {
        const o = get(id);
        if (!o) return;
        const V = await kit();
        const k = 'rasdlg:113';
        let cancelled = false;
        const box = V.openDialog({
            id: `dreamosVpnDialing-${o.id}`,
            key: k,
            title: fill(RAS.connecting, o.name),
            bareCaption: true,
            cancel: () => { cancelled = true; },
            init: (c) => { c.text(1097, fill(RAS.connecting, o.host)); }
        });
        const step = (text, ms) => new Promise((res) => root.setTimeout(() => { if (box && !cancelled) box.text(1097, text); res(); }, ms));
        if (isNightshade(o)) {
            await step(RAS.verifying, 700);
            const cp = root.melatonControlPanel;
            if (!nightshadeUp() && cp && typeof cp.toggleConnection === 'function') cp.toggleConnection();
            await step(RAS.registering, 700);
            if (box && !cancelled) box.close();
            if (!cancelled) update(o.id, { lastConnected: Date.now() });
            return;
        }
        // PPTP / L2TP to another server: a page cannot open GRE or IPsec, so the server never answers, as on the VM
        await new Promise((res) => root.setTimeout(res, 2200));
        if (cancelled) return;
        if (box) box.close();
        await errorBox(o, 800);
    }

    async function errorBox(o) {
        const V = await kit();
        const deadline = Date.now() + 60000;
        let timer = 0;
        let redial = 0;
        const stop = () => { root.clearInterval(timer); root.clearTimeout(redial); };
        const ctx = V.openDialog({
            id: `dreamosVpnError-${o.id}`,
            key: 'rasdlg:111',
            title: fill(RAS.errorTitle, o.name),
            bareCaption: true,
            // rasdial sizes the box to its message at run time: on the VM the logging part and the buttons sit 83 px
            // above the template's places and the window is that much shorter (438 x 322)
            overrides: { 1638: { image: SHIELD, nudge: [0, -83, 0, 0] }, 1712: { nudge: [0, -83, 0, 0] }, 1716: { nudge: [0, -83, 0, 0] }, 1735: { nudge: [0, -83, 0, 0] }, 1736: { nudge: [0, -83, 0, 0] }, 1: { nudge: [0, -83, 0, 0] }, 2: { nudge: [0, -83, 0, 0] }, 1069: { nudge: [0, -83, 0, 0] }, 1070: { nudge: [0, 0, 0, -83] } },
            buttons: {
                1: (c) => { stop(); c.close(); void dial(o.id); },
                2: (c) => { stop(); c.close(); },
                1069: (c) => { stop(); c.close(); const cp = root.melatonControlPanel; if (cp && typeof cp.diagnose === 'function') void cp.diagnose(); }
            },
            cancel: stop,
            init: (c) => {
                c.html(1070, `<span class="vdt-st-text" style="white-space:pre-wrap">${esc(fill(RAS.connecting, o.host))}<br><br>${esc(RAS.error800)}</span>`);
                const h = parseFloat(c.content.style.height);
                if (h) c.content.style.height = `${h - 83}px`;
                const paint = () => c.text(1, fill(RAS.redial, Math.max(0, Math.ceil((deadline - Date.now()) / 1000))));
                paint();
                // Redial = 60 counts down (the VM's) and redials at the deadline: one timeout for the redial, the label
                // redrawn once a second only while the box can be seen (perf rules: no ticking behind a screen off)
                redial = root.setTimeout(() => { stop(); if (c.modal.isConnected) { c.close(); void dial(o.id); } }, deadline - Date.now());
                timer = root.setInterval(() => {
                    if (!c.modal.isConnected) { stop(); return; }
                    if (doc && !doc.hidden && doc.documentElement.dataset.screenOff === undefined) paint();
                }, 1000);
            }
        });
        return ctx;
    }

    // ---- <name> Properties ----------------------------------------------------------------------------------------

    const VPN_TYPES = [{ value: 'auto', text: 'Automatic' }, { value: 'pptp', text: 'PPTP VPN' }, { value: 'l2tp', text: 'L2TP IPsec VPN' }]; // rasdlg 523-525
    const ITEMS = [
        ['ipv6', 'Internet Protocol Version 6 (TCP/IPv6)', 'TCP/IP version 6. The latest version of the internet protocol that provides communication across diverse interconnected networks.'],
        ['ipv4', 'Internet Protocol Version 4 (TCP/IPv4)', 'Transmission Control Protocol/Internet Protocol. The default wide area network protocol that provides communication across diverse interconnected networks.'],
        ['share', 'File and Printer Sharing for Microsoft Networks', 'Allows other computers to access resources on your computer using a Microsoft network.'],
        ['qos', 'QoS Packet Scheduler', 'Quality of Service Packet Scheduler. Provides network traffic control, including flow-of-service and prioritization services.'],
        ['client', 'Client for Microsoft Networks', 'Allows your computer to access resources on a Microsoft network.']
    ];

    async function openProperties(id, owner) {
        const o = get(id);
        if (!o) return null;
        const V = await kit();
        const G = 'rasdlg:1425';
        const O = 'rasdlg:1426';
        const S = 'rasdlg:164';
        const N = 'rasdlg:158';
        const H = 'netshell:10751';
        return V.openSheet({
            id: `dreamosVpnProps-${o.id}`,
            title: `${o.name} Properties`,
            icon: `${NET}/ncpa-vpn-16.png`,
            captionIcon: true,
            owner,
            noApply: true,
            pages: [
                { key: G },
                // Redial attempts has its up-down at run time (the VM's), 0 - 999999999
                { key: O, overrides: { 1748: { skip: true }, 1744: { skip: true }, 1287: { spin: [0, 999999999] } } },
                { key: S },
                { key: N, overrides: { 1252: { disabled: true }, 1254: { disabled: true } } },
                // the VM's Sharing page for a VPN: the taller group (104), the greyed "Establish a dial-up connection ..."
                // where the home network combo would be, the rest 35 px lower
                { key: H, overrides: { 103: { skip: true }, 104: { nudge: [0, 0, 0, 8] }, 115: { skip: true }, 106: { html: '<label class="dsvpn-fake-check is-disabled"><input type="checkbox" disabled><span>Establish a dial-up connection whenever a computer on my network attempts to access the Internet</span></label>', cls: 'dsvpn-establish', nudge: [-17, 4, 23, 18] }, 107: { skip: true }, 108: { skip: true }, 109: { nudge: [0, 35, 0, 0] }, 110: { nudge: [0, 35, 0, 0] }, 111: { nudge: [0, 35, 0, 0] }, 112: { disabled: true, nudge: [0, 35, 0, 0] } } }
            ],
            init: (c) => {
                c.set(1427, o.host || '', G);
                c.options(1429, [], undefined, G);
                c.enable(1429, false, G);
                const opt = o.options || {};
                c.set(1284, opt.progress !== false, O);
                c.set(1554, opt.prompt !== false, O);
                c.set(1555, opt.includeDomain !== false, O);
                c.set(1287, String(opt.redial == null ? 3 : opt.redial), O);
                c.options(1292, ['1 second', '3 seconds', '5 seconds', '10 seconds', '30 seconds', '1 minute', '2 minutes', '5 minutes', '10 minutes'], opt.interval || '1 minute', O);
                c.options(1291, ['never', '1 minute', '5 minutes', '10 minutes', '20 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '8 hours', '24 hours'], opt.idle || 'never', O);
                c.options(1739, [], undefined, O);
                c.enable(1739, false, O);
                c.set(1286, opt.redialDropped !== false, O);
                c.on(1419, 'click', () => { void pppSettings(o.id, c.modal); }, O);
                const sec = o.security || {};
                const adv = !!(o.security && o.security.advanced);
                c.set(1540, !adv, S);
                c.set(1541, adv, S);
                const secSync = () => {
                    const on = !!c.get(1541, S);
                    [1537, 1178, 1174, 1169].forEach((cid) => c.enable(cid, !on, S));
                    [1539, 1180].forEach((cid) => c.enable(cid, on, S));
                };
                c.on(1540, 'change', secSync, S);
                c.on(1541, 'change', secSync, S);
                c.on(1180, 'click', () => { void advancedSecurity(o.id, c.modal); }, S);
                c.on(1598, 'click', () => { void ipsecSettings(o.id, c.modal); }, N);
                root.requestAnimationFrame(secSync);
                c.options(1178, [{ value: 'secured', text: 'Require secured password' }, { value: 'smartcard', text: 'Use smart card' }], sec.verify || 'secured', S);
                c.set(1174, !!sec.autoLogon, S);
                c.set(1169, sec.encrypt !== false, S);
                c.options(1418, VPN_TYPES, o.type || 'auto', N);
                const lv = c.holder(1251, N);
                const body = lv && lv.querySelector('.vdt-lv-body');
                if (body) {
                    // the items drawn as the VM draws them (bound, ticked); the binding is the system's, so a click selects
                // the row and leaves the tick as it is
                const pic = { ipv6: 'class-nettrans-16', ipv4: 'class-nettrans-16', share: 'class-netservice-16', qos: 'class-netservice-16', client: 'class-netclient-16' };
                body.innerHTML = ITEMS.map(([k, name], i) => `<div class="vdt-lv-row dwf-item${i === 0 ? ' is-selected' : ''}" data-value="${k}"><input type="checkbox" checked tabindex="-1" id="dsvpn-it-${o.id}-${k}"><img class="dwf-item-icon" src="${NET}/${pic[k]}.png" srcset="${NET}/${pic[k]}@2x.png 2x" alt="" draggable="false"><label for="dsvpn-it-${o.id}-${k}">${esc(name)}</label></div>`).join('');
                body.querySelectorAll('input[type=checkbox]').forEach((b) => b.addEventListener('click', (ev) => ev.preventDefault()));
                    const pick = (row) => {
                        body.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
                        row.classList.add('is-selected');
                        const it = ITEMS.find((x) => x[0] === row.dataset.value);
                        c.text(1250, it ? it[2] : '', N);
                        c.enable(1253, !!it && (it[0] === 'ipv4' || it[0] === 'ipv6'), N);
                    };
                    body.addEventListener('click', (ev) => { const row = ev.target.closest('.vdt-lv-row'); if (row) pick(row); });
                    pick(body.firstElementChild);
                }
                c.show(106, true, H);
                c.show(104, true, H);
                c.set(105, false, H);
                const host = c.el(1427, G);
                if (host) root.requestAnimationFrame(() => { try { host.focus(); host.select(); } catch (_) { /* gone */ } });
                c.set(109, true, H);
                c.enable(109, false, H);
                c.on(111, 'click', () => call('openHelpAndSupport', 'internet-connection-sharing'), H);
                [1427, 1284, 1554, 1555, 1287, 1292, 1291, 1286, 1178, 1174, 1169, 1418, 105].forEach((cid) => {
                    ['change', 'input'].forEach((ev) => { try { c.on(cid, ev, () => c.dirty()); } catch (_) { /* not on this page */ } });
                });
            },
            apply: (c) => {
                const host = String(c.get(1427, G) || '').trim();
                update(o.id, {
                    host: host || o.host,
                    type: String(c.get(1418, N) || 'auto'),
                    options: {
                        progress: !!c.get(1284, O), prompt: !!c.get(1554, O), includeDomain: !!c.get(1555, O),
                        redial: Math.max(0, Math.min(999999999, Number(c.get(1287, O)) || 0)), interval: c.get(1292, O), idle: c.get(1291, O), redialDropped: !!c.get(1286, O)
                    },
                    security: { ...(get(o.id) || o).security, verify: c.get(1178, S) || 'secured', autoLogon: !!c.get(1174, S), encrypt: !!c.get(1169, S), advanced: !!c.get(1541, S) }
                });
                return true;
            }
        });
    }

    // ---- PPP Settings (rasdlg 502), IPsec Settings (570), Advanced Security Settings (105): the VM's defaults; kept with
    // the connection (never the preshared key) -------------------------------------------------------------------------

    async function pppSettings(id, owner) {
        const o = get(id);
        if (!o) return;
        const V = await kit();
        const ppp = o.ppp || { lcp: true, compression: false, multilink: false };
        V.openDialog({
            id: `dreamosVpnPpp-${id}`, key: 'rasdlg:502', owner, bareCaption: true,
            init: (c) => { c.set(1423, !!ppp.lcp); c.set(1424, !!ppp.compression); c.set(1557, !!ppp.multilink); },
            ok: (c) => { update(id, { ppp: { lcp: !!c.get(1423), compression: !!c.get(1424), multilink: !!c.get(1557) } }); }
        });
    }

    async function ipsecSettings(id, owner) {
        const o = get(id);
        if (!o) return;
        const V = await kit();
        const ip = o.ipsec || { psk: false, verify: true };
        V.openDialog({
            id: `dreamosVpnIpsec-${id}`, key: 'rasdlg:570', owner, bareCaption: true,
            init: (c) => {
                c.set(1604, !!ip.psk);
                c.set(1775, !ip.psk);
                c.set(1776, ip.verify !== false);
                c.set(1605, session.get(`${id}:psk`) || '');
                const sync = () => { const psk = !!c.get(1604); c.enable(1605, psk); c.enable(1602, psk); c.enable(1776, !psk); };
                c.on(1604, 'change', sync);
                c.on(1775, 'change', sync);
                sync();
            },
            ok: (c) => {
                const psk = !!c.get(1604);
                if (psk) session.set(`${id}:psk`, String(c.get(1605) || ''));
                update(id, { ipsec: { psk, verify: !!c.get(1776) } });
            }
        });
    }

    const ENCRYPTION = [
        { value: 'none', text: 'No encryption allowed (server will disconnect if it requires encryption)' },
        { value: 'optional', text: 'Optional encryption (connect even if no encryption)' },
        { value: 'require', text: 'Require encryption (disconnect if server declines)' },
        { value: 'max', text: 'Maximum strength encryption (disconnect if server declines)' }
    ];

    async function advancedSecurity(id, owner) {
        const o = get(id);
        if (!o) return;
        const V = await kit();
        const a = (o.security && o.security.custom) || { encryption: 'require', eap: false, pap: false, chap: false, mschapv2: true, autoLogon: false };
        V.openDialog({
            id: `dreamosVpnAdvSec-${id}`, key: 'rasdlg:105', owner, bareCaption: true,
            overrides: { 1752: { skip: true }, 1035: { disabled: true } },
            init: (c) => {
                c.options(1495, ENCRYPTION, a.encryption || 'require');
                c.options(1034, [], undefined);
                c.set(1544, !!a.eap);
                c.set(1545, !a.eap);
                c.set(1491, !!a.pap); c.set(1494, !!a.chap); c.set(1492, a.mschapv2 !== false); c.set(1549, !!a.autoLogon);
                const sync = () => {
                    const eap = !!c.get(1544);
                    c.enable(1034, eap);
                    [1491, 1494, 1492].forEach((cid) => c.enable(cid, !eap));
                    c.enable(1549, !eap && !!c.get(1492));
                };
                [1544, 1545, 1492].forEach((cid) => c.on(cid, 'change', sync));
                sync();
            },
            ok: (c) => {
                const now = get(id) || o;
                update(id, { security: { ...(now.security || {}), custom: { encryption: c.get(1495), eap: !!c.get(1544), pap: !!c.get(1491), chap: !!c.get(1494), mschapv2: !!c.get(1492), autoLogon: !!c.get(1549) } } });
            }
        });
    }

    root.dreamosVpn = { list, get, remove, rename, update, freeName, device, isNightshade, connected, openWizard, openConnect, openProperties, dial };
})(typeof window !== 'undefined' ? window : globalThis);
