nsp = 'Old browser!';
dl = document.layers;
oe = window.opera ? 1 : 0;
da = document.all && !oe;
ge = document.getElementById;
ws = window.sidebar ? true : false;
tN = navigator.userAgent.toLowerCase();
izN = tN.indexOf('netscape') >= 0 ? true : false;
zis = tN.indexOf('msie 7') >= 0 ? true : false;
zis8 = tN.indexOf('msie 8') >= 0 ? true : false;
zis |= zis8;
if (ws && !izN) {
    quogl = 'iuy'
}
;
var msg = '';
function nem() {
    return true
}
;
window.onerror = nem;
zOF = window.location.protocol.indexOf("file") != -1 ? true : false;
i7f = zis && !zOF ? true : false;
System.Gadget.settingsUI = "settings.html";
var size = 1;
function onLoad() {
    size = System.Gadget.Settings.read("size");
    if (size != "");
    else size = "1";
    if (size <= "4");
    else size = "4";
    FlyoutBac = System.Gadget.Settings.read("FlyoutBac");
    if (FlyoutBac != "");
    else FlyoutBac = "#080808";
    fixFlyoutBac = System.Gadget.Settings.read("fixFlyoutBac");
    if (fixFlyoutBac != "") sFlyoutBac = fixFlyoutBac;
    else sFlyoutBac = FlyoutBac;
    FlyoutTit = System.Gadget.Settings.read("FlyoutTit");
    if (FlyoutTit != "");
    else FlyoutTit = "#87cefa";
    fixFlyoutTit = System.Gadget.Settings.read("fixFlyoutTit");
    if (fixFlyoutTit != "") sFlyoutTit = fixFlyoutTit;
    else sFlyoutTit = FlyoutTit;
    FlyoutDet = System.Gadget.Settings.read("FlyoutDet");
    if (FlyoutDet != "");
    else FlyoutDet = "#ffcc00";
    fixFlyoutDet = System.Gadget.Settings.read("fixFlyoutDet");
    if (fixFlyoutDet != "") sFlyoutDet = fixFlyoutDet;
    else sFlyoutDet = FlyoutDet;
    var locator = new ActiveXObject("WbemScripting.SWbemLocator");
    var service = locator.ConnectServer(".");
    var properties = service.ExecQuery("SELECT * FROM Win32_DiskDrive");
    var e = new Enumerator(properties);
    document.write("<div>");
    for (;
  !e.atEnd();
  e.moveNext()) {
        p = e.item();
        var csize = Math.round(((p.Size / 1024) / 1024) / 1024);
        document.write("<span style=font-size:12px;color:" + sFlyoutDet + "><u>" + p.Model +
    "</u></span><br>");
        document.write("Media Type: <span style='color:" + sFlyoutDet + "'>" + p.MediaType +
    "</span><br>");
        document.write("Serial Number: <span style='color:" + sFlyoutDet + "'>" + p.
    SerialNumber + "</span><br>");
        document.write("Interface Type: <span style='color:" + sFlyoutDet + "'>" + p.
    InterfaceType + "</span><br>");
        document.write("Capacity: <span style='color:" + sFlyoutDet + "'>" + p.Size +
    " bytes   ( " + csize + " GB)</span><br>");
        document.write("Index: <span style='color:" + sFlyoutDet + "'>" + p.Index +
    "</span><br>");
        document.write("Partitions: <span style='color:" + sFlyoutDet + "'>" + p.Partitions +
    "</span><br>");
        document.write("Signature: <span style='color:" + sFlyoutDet + "'>" + p.Signature +
    "</span><br>");
        document.write("Firmware Revision: <span style='color:" + sFlyoutDet + "'>" + p.
    FirmwareRevision + "</span><br>");
        document.write("Total Cylinders: <span style='color:" + sFlyoutDet + "'>" + p.
    TotalCylinders + "</span><br>");
        document.write("Total Sectors: <span style='color:" + sFlyoutDet + "'>" + p.
    TotalSectors + "</span><br>");
        document.write("Total Heads: <span style='color:" + sFlyoutDet + "'>" + p.TotalHeads +
    "</span><br>");
        document.write("Total Tracks: <span style='color:" + sFlyoutDet + "'>" + p.TotalTracks
     + "</span><br>");
        document.write("Bytes per Sector: <span style='color:" + sFlyoutDet + "'>" + p.
    BytesPerSector + "</span><br>");
        document.write("Sectors per Track: <span style='color:" + sFlyoutDet + "'>" + p.
    SectorsPerTrack + "</span><br>");
        document.write("Tracks per Cylinder: <span style='color:" + sFlyoutDet + "'>" + p.
    TracksPerCylinder + "</span><br>");
        document.write("<br>");
    }
    document.write("</div>");
    sizeMode();
}
function sizeMode() {
    document.body.style.width = parseInt(260 * size);
    document.body.style.height = parseInt(220 * size);
    document.body.style.backgroundColor = sFlyoutBac;
    document.body.style.fontFamily = "Segoe UI";
    document.body.style.fontSize = parseInt(11 * size);
    document.body.style.color = sFlyoutTit;
    document.body.alinkColor = sFlyoutDet;
    document.vlinkColor = sFlyoutDet;
    document.body.style.overflow = "auto";
    document.body.style.marginTop = 4;
    document.body.style.marginLeft = 4;
}