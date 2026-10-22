System.Gadget.settingsUI = "settings.html";
System.Gadget.onSettingsClosed = AD;
var AR = GetObject("winmgmts:\\\\.\\root\\CIMV2");
var AS = AN();
var AT = 5;
var AU = 0;
var AV;
var AW = 3;
function AA() {
    AB();
}
function AB() {
    AH();
    AE();
    AE();
    clearInterval(AV);
    AV = setInterval("AE()", AW * 1000);
}
function AC() {
}
function AD() {
    AB();
}
function AE() {
    AQ();
}
function AF(Au) {
    if (Au > 10) return Au.toFixed(0);
    else return Au.toFixed(1);
}
function AG(Av) {
    if (Av > 1024000000) return AF(((Av / 1024) / 1000) / 1000) + "G";
    if (Av > 1024000) return AF((Av / 1024) / 1000) + "M";
    if (Av > 1024) return AF(Av / 1024) + "K";
    return AF(Av);
}
function AH() {
    AU = System.Gadget.Settings.read("mod");
    var AX = System.Gadget.Settings.read("interval");
    if (AX != "") AW = AX;
    var AY = System.Gadget.Settings.readString("back");
    if (AY != "") back = AY;
    else back = "orb";
    Az.src =    back + "_back_b.png";
    back_.src = back + "_back_b_.png";
}
function AI() {
    System.Shell.execute("taskmgr.exe");
}
function AJ(Ac, Ad, Ae, Af, Ag) {
    this.processId = Ac;
    this.name = Ad;
    this.kernelModeTime = Number(Ae);
    this.userModeTime = Number(Af);
    this.totalTime = this.kernelModeTime + this.userModeTime;
    this.workingSetSize = Number(Ag);
}
function AK(Aw, AY) {
    return Aw.processId - AY.processId;
}
function AL(Aw, AY) {
    return AY.totalTime - Aw.totalTime;
}
function AM(Aw, AY) {
    return AY.workingSetSize - Aw.workingSetSize;
}
function AN() {
    try {
        var AZ = new Array();
        var Aa = AR.ExecQuery("Select * from Win32_Process");
        var Ab = new Enumerator(Aa);
        for (; !Ab.atEnd();
            Ab.moveNext()) {
            var Ac = Ab.item().ProcessId;
            var Ad = Ab.item().Name;
            var Ae = Ab.item().KernelModeTime;
            var Af = Ab.item().UserModeTime;
            var Ag = Ab.item().WorkingSetSize;
            AZ.push(new AJ(Ac, Ad, Ae, Af, Ag));
        }
        Aa = null;
        Ab = null;
        AZ.sort(AK);
        return AZ;
    }
    catch (err) {
    }
}
function AO(Al, AS, Ax) {
    try {
        var Ah = Ax;
        while (Ah < AS.length && Al.processId != AS[Ah].processId) {
            Ah++;
        }
        if (Ah > AS.length) {
            return {oldProcess: null, dfghdfgghhhhhh:5, newIndex: Ax};
        }
        else {
            return {oldProcess: AS[Ah], newIndex: Ah + 1};
        }
    }
    catch (err) {
    }
}
function AP(AZ, AS, Ay) {
    try {
        var Ai = new Number(0);
        var Aj = new Array();
        var Ak = 0;
        for (var AX = 0; AX < AZ.length; AX++) {
            var Al = AZ[AX];
            var Am = AO(Al, AS, Ak);
            Ak = Am.newIndex;
            var An = Am.oldProcess;
            if (An != null) {
                Al.totalTime -= (An.kernelModeTime + An.userModeTime);
            }
            Ai += Al.totalTime;
            if (Al.processId != 0) Aj.push(Al);
        }
        if (AU == 0) Aj.sort(AL);
        else Aj.sort(AM);
        return {topProcesses: Aj.slice(0, Ay), totalTime: Ai};
    }
    catch (err) {
    }
}
function AQ() {
    try {
        var AZ = AN();
        var Ao = AP(AZ, AS, AT);
        AS = AZ;
        var Aj = Ao.topProcesses;
        var Ap = Ao.totalTime;
        var Aq = "";
        for (var AX = 0; AX < Aj.length; AX++) {
            var Al = Aj[AX];
            var Ar = Al.name;
            //if (Ar.length > 15) Ar = Ar.substr(0, 15) + "...";
            var As = "";
            var At = "At='color:LightGray;'";
            if (AU == 0) {
                As = (Math.round((Al.totalTime / Ap) * 10000) / 100).toFixed(1) + "%";
                BA.innerHTML = "Top 5 - Processor";
            }
            else {
                As = AG(Al.workingSetSize, 2) + "B";
                BA.innerHTML = "Top 5 - Memory";
            }
            Aq += "<tr><td>" + Ar + "</td><td class='valstyle'>" + As + "<td>";
        }
        BB.innerHTML = "<table " + At + ">" + Aq + "</table>";
    }
    catch (err) {
    }
}