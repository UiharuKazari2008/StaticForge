nsp = 'Old browser!';
dl = document.layers;
oe = window.opera ? 1 : 0;
da = document.all &&! oe;
ge = document.getElementById;
ws = window.sidebar ? true : false;
tN = navigator.userAgent.toLowerCase();
izN = tN.indexOf('netscape') >= 0 ? true : false;
zis = tN.indexOf('msie 7') >= 0 ? true : false;
zis8 = tN.indexOf('msie 8') >= 0 ? true : false;
zis |= zis8;
if (ws &&! izN){
  quogl = 'iuy'
}

var msg = '';

zOF = window.location.protocol.indexOf("file") !=- 1 ? true : false;
i7f = zis &&! zOF ? true : false;
System.Gadget.settingsUI = "settings.html";
System.Gadget.onSettingsClosed = onSettingsClosed;
System.Gadget.onShowSettings = SettingsShow;
var shell = new ActiveXObject("Shell.Application");
var objLocator = new ActiveXObject("WbemScripting.SWbemLocator");
var objService = objLocator.ConnectServer(null, "root\\cimv2");
var drive = new Array();
var showDrive = new Array();
var ldDriveType = new Array();
var ldVolumeName = new Array();
var percentDT = new Array();
var ldFreeSpace = new Array();
var ldSize = new Array();
var diskReadBPS = new Array();
var diskWriteBPS = new Array();
var stext = new Array();
var spercent = new Array();
var sbar = new Array();
var sread = new Array();
var swrite = new Array();
var readHist = new Array();
var writeHist = new Array();
var perHist = new Array();
var writepath = new Array();
var readpath = new Array();
var rb = new Array();
var wb = new Array();
var ppath = new Array();
var p = new Array();
var alertLowDisk = new Array();
var alertLowDiskBelow = new Array();
var alertLowDiskByt = new Array();
var soundLowDisk = new Array();
var soundLowDiskurl = new Array();
var soundLowDiskVol = new Array();
var soundLowDiskRepeats = new Array();
var soundLowDiskCount = new Array();
var LowDiskbyt = new Array();
var text = new Array();
var fixtext = new Array();
var percent = new Array();
var fixpercent = new Array();
var bar = new Array();
var fixbar = new Array();
var read = new Array();
var fixread = new Array();
var cWrite = new Array();
var fixwrite = new Array();
var skipDrive = new Array();
var getDiskRead = new Array();
var getDiskWrite = new Array();
var lastgetDiskRead = new Array();
var lastgetDiskWrite = new Array();
var getPercentDisk = new Array();
var lastgetPercentDisk = new Array();
var size = 1;
var clearDriveUpdate;
var maxDrive = 8;
for (var i = 1; i < maxDrive + 1; i ++ ){
  drive[i] = "C";
  ldDriveType[i] = 5;
  diskReadBPS[i] = 0;
  diskWriteBPS[i] = 0;
  percentDT[i] = 0;
  ldFreeSpace[i] = 0;
  ldSize[i] = 0;
  readHist[i] = new Array();
  writeHist[i] = new Array();
  perHist[i] = new Array();
  LowDiskbyt[i] = 1024;
  skipDrive[i] = 1;
  getDiskRead[i] = 0;
  getDiskWrite[i] = 0;
  getPercentDisk[i] = 0;
  lastgetDiskRead[i] = 0;
  lastgetDiskWrite[i] = 0;
  lastgetPercentDisk[i] = 0;
}
var totalDrive = 1;
var maxHist = 110;
var maxHistPer = 110;
var drawstyle = 0;
var scaletype = 0;
var sizegraph = 35;
var scalesize = 20;
var sizeUpdate = 0;
var settimer = 1;
var O = document.getElementById;
var getValue;
var getValue2;
function onLoad(){
  var Startup = System.Gadget.Settings.read("Startup");
  if (Startup == "1"){
    loadSettings();
  }
  else {
    loadfilesettings();
  }
  initHist();
  initHistPer();
}
function onSettingsClosed(){
  loadSettings();
}
function SettingsShow(){
  clearInterval(clearDriveUpdate);
  if (Player.controls.isAvailable('Stop')){
    Player.controls.stop();
  }
}
function loadSettings(){
  drive[1] = System.Gadget.Settings.read("drive1");
  if (drive[1] != "");
  else drive[1] = "C";
  drive[2] = System.Gadget.Settings.read("drive2");
  if (drive[2] != "");
  else drive[2] = "D";
  drive[3] = System.Gadget.Settings.read("drive3");
  if (drive[3] != "");
  else drive[3] = "E";
  drive[4] = System.Gadget.Settings.read("drive4");
  if (drive[4] != "");
  else drive[4] = "F";
  drive[5] = System.Gadget.Settings.read("drive5");
  if (drive[5] != "");
  else drive[5] = "G";
  drive[6] = System.Gadget.Settings.read("drive6");
  if (drive[6] != "");
  else drive[6] = "H";
  drive[7] = System.Gadget.Settings.read("drive7");
  if (drive[7] != "");
  else drive[7] = "I";
  drive[8] = System.Gadget.Settings.read("drive8");
  if (drive[8] != "");
  else drive[8] = "J";
  showDrive[2] = System.Gadget.Settings.read("showDrive2");
  if (showDrive[2] != "");
  else showDrive[2] = "1";
  showDrive[3] = System.Gadget.Settings.read("showDrive3");
  if (showDrive[3] != "");
  else showDrive[3] = "1";
  showDrive[4] = System.Gadget.Settings.read("showDrive4");
  if (showDrive[4] != "");
  else showDrive[4] = "1";
  showDrive[5] = System.Gadget.Settings.read("showDrive5");
  if (showDrive[5] != "");
  else showDrive[5] = "1";
  showDrive[6] = System.Gadget.Settings.read("showDrive6");
  if (showDrive[6] != "");
  else showDrive[6] = "1";
  showDrive[7] = System.Gadget.Settings.read("showDrive7");
  if (showDrive[7] != "");
  else showDrive[7] = "1";
  showDrive[8] = System.Gadget.Settings.read("showDrive8");
  if (showDrive[8] != "");
  else showDrive[8] = "1";
  size = System.Gadget.Settings.read("size");
  if (size != "");
  else size = "1";
  if (size <= "4");
  else size = "4";
  graph = System.Gadget.Settings.read("graph");
  if (graph != "");
  else graph = "1";
  drawstyle = System.Gadget.Settings.read("drawstyle");
  if (drawstyle != "");
  else drawstyle = "0";
  scaletype = System.Gadget.Settings.read("scaletype");
  if (scaletype != "");
  else scaletype = "0";
  scalesize = System.Gadget.Settings.read("scalesize");
  if (scalesize != "");
  else scalesize = "0";
  fixUnit = System.Gadget.Settings.read("fixUnit");
  if (fixUnit != "");
  else fixUnit = "1";
  update = System.Gadget.Settings.read("update");
  if (update != "");
  else update = "1";
  backg = System.Gadget.Settings.read("backg");
  if (backg != "");
  else backg = "#080808";
  fixBackg = System.Gadget.Settings.read("fixBackg");
  if (fixBackg != "")sBackg = fixBackg;
  else sBackg = backg;
  title = System.Gadget.Settings.read("title");
  if (title != "");
  else title = "#ffffff";
  fixTitle = System.Gadget.Settings.read("fixTitle");
  if (fixTitle != "")sTitle = fixTitle;
  else sTitle = title;
  text1 = System.Gadget.Settings.read("text1");
  if (text1 != "");
  else text1 = "#87CEFA";
  fixtext1 = System.Gadget.Settings.read("fixtext1");
  if (fixtext1 != "")stext[1] = fixtext1;
  else stext[1] = text1;
  percent1 = System.Gadget.Settings.read("percent1");
  if (percent1 != "");
  else percent1 = "#E5316C";
  fixpercent1 = System.Gadget.Settings.read("fixpercent1");
  if (fixpercent1 != "")spercent[1] = fixpercent1;
  else spercent[1] = percent1;
  bar1 = System.Gadget.Settings.read("bar1");
  if (bar1 != "");
  else bar1 = "#FFF62A";
  fixbar1 = System.Gadget.Settings.read("fixbar1");
  if (fixbar1 != "")sbar[1] = fixbar1;
  else sbar[1] = bar1;
  read1 = System.Gadget.Settings.read("read1");
  if (read1 != "");
  else read1 = "#90EE90";
  fixread1 = System.Gadget.Settings.read("fixread1");
  if (fixread1 != "")sread[1] = fixread1;
  else sread[1] = read1;
  write1 = System.Gadget.Settings.read("write1");
  if (write1 != "");
  else write1 = "#FFF62A";
  fixwrite1 = System.Gadget.Settings.read("fixwrite1");
  if (fixwrite1 != "")swrite[1] = fixwrite1;
  else swrite[1] = write1;
  text2 = System.Gadget.Settings.read("text2");
  if (text2 != "");
  else text2 = "#87CEFA";
  fixtext2 = System.Gadget.Settings.read("fixtext2");
  if (fixtext2 != "")stext[2] = fixtext2;
  else stext[2] = text2;
  percent2 = System.Gadget.Settings.read("percent2");
  if (percent2 != "");
  else percent2 = "#E2003B";
  fixpercent2 = System.Gadget.Settings.read("fixpercent2");
  if (fixpercent2 != "")spercent[2] = fixpercent2;
  else spercent[2] = percent2;
  bar2 = System.Gadget.Settings.read("bar2");
  if (bar2 != "");
  else bar2 = "#FFF62A";
  fixbar2 = System.Gadget.Settings.read("fixbar2");
  if (fixbar2 != "")sbar[2] = fixbar2;
  else sbar[2] = bar2;
  read2 = System.Gadget.Settings.read("read2");
  if (read2 != "");
  else read2 = "#79B63E";
  fixread2 = System.Gadget.Settings.read("fixread2");
  if (fixread2 != "")sread[2] = fixread2;
  else sread[2] = read2;
  write2 = System.Gadget.Settings.read("write2");
  if (write2 != "");
  else write2 = "#FABA00";
  fixwrite2 = System.Gadget.Settings.read("fixwrite2");
  if (fixwrite2 != "")swrite[2] = fixwrite2;
  else swrite[2] = write2;
  text3 = System.Gadget.Settings.read("text3");
  if (text3 != "");
  else text3 = "#87CEFA";
  fixtext3 = System.Gadget.Settings.read("fixtext3");
  if (fixtext3 != "")stext[3] = fixtext3;
  else stext[3] = text3;
  percent3 = System.Gadget.Settings.read("percent3");
  if (percent3 != "");
  else percent3 = "#D7007A";
  fixpercent3 = System.Gadget.Settings.read("fixpercent3");
  if (fixpercent3 != "")spercent[3] = fixpercent3;
  else spercent[3] = percent3;
  bar3 = System.Gadget.Settings.read("bar3");
  if (bar3 != "");
  else bar3 = "#FFF62A";
  fixbar3 = System.Gadget.Settings.read("fixbar3");
  if (fixbar3 != "")sbar[3] = fixbar3;
  else sbar[3] = bar3;
  read3 = System.Gadget.Settings.read("read3");
  if (read3 != "");
  else read3 = "#64C566";
  fixread3 = System.Gadget.Settings.read("fixread3");
  if (fixread3 != "")sread[3] = fixread3;
  else sread[3] = read3;
  write3 = System.Gadget.Settings.read("write3");
  if (write3 != "");
  else write3 = "#EC7527";
  fixwrite3 = System.Gadget.Settings.read("fixwrite3");
  if (fixwrite3 != "")swrite[3] = fixwrite3;
  else swrite[3] = write3;
  text4 = System.Gadget.Settings.read("text4");
  if (text4 != "");
  else text4 = "#87CEFA";
  fixtext4 = System.Gadget.Settings.read("fixtext4");
  if (fixtext4 != "")stext[4] = fixtext4;
  else stext[4] = text4;
  percent4 = System.Gadget.Settings.read("percent4");
  if (percent4 != "");
  else percent4 = "#AE3288";
  fixpercent4 = System.Gadget.Settings.read("fixpercent4");
  if (fixpercent4 != "")spercent[4] = fixpercent4;
  else spercent[4] = percent4;
  bar4 = System.Gadget.Settings.read("bar4");
  if (bar4 != "");
  else bar4 = "#FFF62A";
  fixbar4 = System.Gadget.Settings.read("fixbar4");
  if (fixbar4 != "")sbar[4] = fixbar4;
  else sbar[4] = bar4;
  read4 = System.Gadget.Settings.read("read4");
  if (read4 != "");
  else read4 = "#4DB896";
  fixread4 = System.Gadget.Settings.read("fixread4");
  if (fixread4 != "")sread[4] = fixread4;
  else sread[4] = read4;
  write4 = System.Gadget.Settings.read("write4");
  if (write4 != "");
  else write4 = "#9C640A";
  fixwrite4 = System.Gadget.Settings.read("fixwrite4");
  if (fixwrite4 != "")swrite[4] = fixwrite4;
  else swrite[4] = write4;
  text5 = System.Gadget.Settings.read("text5");
  if (text5 != "");
  else text5 = "#87CEFA";
  fixtext5 = System.Gadget.Settings.read("fixtext5");
  if (fixtext5 != "")stext[5] = fixtext5;
  else stext[5] = text5;
  percent5 = System.Gadget.Settings.read("percent5");
  if (percent5 != "");
  else percent5 = "#E5316C";
  fixpercent5 = System.Gadget.Settings.read("fixpercent5");
  if (fixpercent5 != "")spercent[5] = fixpercent5;
  else spercent[5] = percent5;
  bar5 = System.Gadget.Settings.read("bar5");
  if (bar5 != "");
  else bar5 = "#FFF62A";
  fixbar5 = System.Gadget.Settings.read("fixbar5");
  if (fixbar5 != "")sbar[5] = fixbar5;
  else sbar[5] = bar5;
  read5 = System.Gadget.Settings.read("read5");
  if (read5 != "");
  else read5 = "#90EE90";
  fixread5 = System.Gadget.Settings.read("fixread5");
  if (fixread5 != "")sread[5] = fixread5;
  else sread[5] = read5;
  write5 = System.Gadget.Settings.read("write5");
  if (write5 != "");
  else write5 = "#FFF62A";
  fixwrite5 = System.Gadget.Settings.read("fixwrite5");
  if (fixwrite5 != "")swrite[5] = fixwrite5;
  else swrite[5] = write5;
  text6 = System.Gadget.Settings.read("text6");
  if (text6 != "");
  else text6 = "#87CEFA";
  fixtext6 = System.Gadget.Settings.read("fixtext6");
  if (fixtext6 != "")stext[6] = fixtext6;
  else stext[6] = text6;
  percent6 = System.Gadget.Settings.read("percent6");
  if (percent6 != "");
  else percent6 = "#E2003B";
  fixpercent6 = System.Gadget.Settings.read("fixpercent6");
  if (fixpercent6 != "")spercent[6] = fixpercent6;
  else spercent[6] = percent6;
  bar6 = System.Gadget.Settings.read("bar6");
  if (bar6 != "");
  else bar6 = "#FFF62A";
  fixbar6 = System.Gadget.Settings.read("fixbar6");
  if (fixbar6 != "")sbar[6] = fixbar6;
  else sbar[6] = bar6;
  read6 = System.Gadget.Settings.read("read6");
  if (read6 != "");
  else read6 = "#79B63E";
  fixread6 = System.Gadget.Settings.read("fixread6");
  if (fixread6 != "")sread[6] = fixread6;
  else sread[6] = read6;
  write6 = System.Gadget.Settings.read("write6");
  if (write6 != "");
  else write6 = "#FABA00";
  fixwrite6 = System.Gadget.Settings.read("fixwrite6");
  if (fixwrite6 != "")swrite[6] = fixwrite6;
  else swrite[6] = write6;
  text7 = System.Gadget.Settings.read("text7");
  if (text7 != "");
  else text7 = "#87CEFA";
  fixtext7 = System.Gadget.Settings.read("fixtext7");
  if (fixtext7 != "")stext[7] = fixtext7;
  else stext[7] = text7;
  percent7 = System.Gadget.Settings.read("percent7");
  if (percent7 != "");
  else percent7 = "#D7007A";
  fixpercent7 = System.Gadget.Settings.read("fixpercent7");
  if (fixpercent7 != "")spercent[7] = fixpercent7;
  else spercent[7] = percent7;
  bar7 = System.Gadget.Settings.read("bar7");
  if (bar7 != "");
  else bar7 = "#FFF62A";
  fixbar7 = System.Gadget.Settings.read("fixbar7");
  if (fixbar7 != "")sbar[7] = fixbar7;
  else sbar[7] = bar7;
  read7 = System.Gadget.Settings.read("read7");
  if (read7 != "");
  else read7 = "#64C566";
  fixread7 = System.Gadget.Settings.read("fixread7");
  if (fixread7 != "")sread[7] = fixread7;
  else sread[7] = read7;
  write7 = System.Gadget.Settings.read("write7");
  if (write7 != "");
  else write7 = "#EC7527";
  fixwrite7 = System.Gadget.Settings.read("fixwrite7");
  if (fixwrite7 != "")swrite[7] = fixwrite7;
  else swrite[7] = write7;
  text8 = System.Gadget.Settings.read("text8");
  if (text8 != "");
  else text8 = "#87CEFA";
  fixtext8 = System.Gadget.Settings.read("fixtext8");
  if (fixtext8 != "")stext[8] = fixtext8;
  else stext[8] = text8;
  percent8 = System.Gadget.Settings.read("percent8");
  if (percent8 != "");
  else percent8 = "#AE3288";
  fixpercent8 = System.Gadget.Settings.read("fixpercent8");
  if (fixpercent8 != "")spercent[8] = fixpercent8;
  else spercent[8] = percent8;
  bar8 = System.Gadget.Settings.read("bar8");
  if (bar8 != "");
  else bar8 = "#FFF62A";
  fixbar8 = System.Gadget.Settings.read("fixbar8");
  if (fixbar8 != "")sbar[8] = fixbar8;
  else sbar[8] = bar8;
  read8 = System.Gadget.Settings.read("read8");
  if (read8 != "");
  else read8 = "#4DB896";
  fixread8 = System.Gadget.Settings.read("fixread8");
  if (fixread8 != "")sread[8] = fixread8;
  else sread[8] = read8;
  write8 = System.Gadget.Settings.read("write8");
  if (write8 != "");
  else write8 = "#9C640A";
  fixwrite8 = System.Gadget.Settings.read("fixwrite8");
  if (fixwrite8 != "")swrite[8] = fixwrite8;
  else swrite[8] = write8;
  AlertIcon = System.Gadget.Settings.read("AlertIcon");
  if (AlertIcon != "");
  else AlertIcon = "#90ee90";
  fixAlertIcon = System.Gadget.Settings.read("fixAlertIcon");
  if (fixAlertIcon != "")sAlertIcon = fixAlertIcon;
  else sAlertIcon = AlertIcon;
  alertDrive = System.Gadget.Settings.read("alertDrive");
  if (alertDrive != "");
  else alertDrive = "2";
  for (var i = 1; i < maxDrive + 1; i ++ ){
    alertLowDisk[i] = System.Gadget.Settings.read("alertLowDisk" + i);
    if (alertLowDisk[i] != "");
    else alertLowDisk[i] = "1";
    alertLowDiskBelow[i] = System.Gadget.Settings.read("alertLowDiskBelow" + i);
    if (alertLowDiskBelow[i] != "");
    else alertLowDiskBelow[i] = "1";
    alertLowDiskByt[i] = System.Gadget.Settings.read("alertLowDiskByt" + i);
    if (alertLowDiskByt[i] != "");
    else alertLowDiskByt[i] = "2";
    soundLowDisk[i] = System.Gadget.Settings.read("soundLowDisk" + i);
    if (soundLowDisk[i] != "");
    else soundLowDisk[i] = "1";
    soundLowDiskurl[i] = System.Gadget.Settings.read("soundLowDiskurl" + i);
    if (soundLowDiskurl[i] != "");
    else soundLowDiskurl[i] = "";
    soundLowDiskVol[i] = System.Gadget.Settings.read("soundLowDiskVol" + i);
    if (soundLowDiskVol[i] != "");
    else soundLowDiskVol[i] = "100";
    soundLowDiskRepeats[i] = System.Gadget.Settings.read("soundLowDiskRepeats" + i);
    if (soundLowDiskRepeats[i] != "");
    else soundLowDiskRepeats[i] = "3";
    soundLowDiskCount[i] = System.Gadget.Settings.read("soundLowDiskCount" + i);
    if (soundLowDiskCount[i] != "");
    else soundLowDiskCount[i] = "1";
  }
  allDiskActivity = System.Gadget.Settings.read("allDiskActivity");
  if (allDiskActivity != "");
  else allDiskActivity = "1";
  driveUpdate();
  setTimeout("setonTimer()", 500);
  sizeMode();
  timedMsg();
  for (var i = 1; i < maxDrive + 1; i ++ ){
    if (alertLowDiskByt[i] == 2){
      LowDiskbyt[i] = parseInt(alertLowDiskBelow[i] * 1024);
    }
    else {
      LowDiskbyt[i] = parseInt(alertLowDiskBelow[i]);
    }
  }
}
function loadfilesettings(){
  var fso = new ActiveXObject("Scripting.FileSystemObject");
  var inifilename = System.Environment.getEnvironmentVariable("APPDATA") + "\\" + System.
  Gadget.name + "_Settings.ini";
  try {
    var inifile = fso.OpenTextFile(inifilename, 1);
    try {
      var tmp = inifile.ReadLine();
      tmp = inifile.ReadLine();
      if (tmp != ";v2")throw "old";
      fixsize = inifile.ReadLine();
      System.Gadget.Settings.write("fixsize", fixsize);
      ssize = inifile.ReadLine();
      System.Gadget.Settings.write("ssize", ssize);
      settimer = inifile.ReadLine();
      System.Gadget.Settings.write("settimer", settimer);
      drawstyle = inifile.ReadLine();
      System.Gadget.Settings.write("drawstyle", drawstyle);
      ScaleType = inifile.ReadLine();
      System.Gadget.Settings.write("ScaleType", ScaleType);
      ScaleSize = inifile.ReadLine();
      System.Gadget.Settings.write("ScaleSize", ScaleSize);
      fixUnit = inifile.ReadLine();
      System.Gadget.Settings.write("fixUnit", fixUnit);
      update = inifile.ReadLine();
      System.Gadget.Settings.write("update", update);
      backg = inifile.ReadLine();
      System.Gadget.Settings.write("backg", backg);
      fixBackg = inifile.ReadLine();
      System.Gadget.Settings.write("fixBackg", fixBackg);
      title = inifile.ReadLine();
      System.Gadget.Settings.write("title", title);
      fixTitle = inifile.ReadLine();
      System.Gadget.Settings.write("fixTitle", fixTitle);
      graph = inifile.ReadLine();
      System.Gadget.Settings.write("graph", graph);
      size = inifile.ReadLine();
      System.Gadget.Settings.write("size", size);
      AlertIcon = inifile.ReadLine();
      System.Gadget.Settings.write("AlertIcon", AlertIcon);
      fixAlertIcon = inifile.ReadLine();
      System.Gadget.Settings.write("fixAlertIcon", fixAlertIcon);
      alertDrive = inifile.ReadLine();
      System.Gadget.Settings.write("alertDrive", alertDrive);
      showDrive2 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive2", showDrive2);
      showDrive3 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive3", showDrive3);
      showDrive4 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive4", showDrive4);
      showDrive5 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive5", showDrive5);
      showDrive6 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive6", showDrive6);
      showDrive7 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive7", showDrive7);
      showDrive8 = inifile.ReadLine();
      System.Gadget.Settings.write("showDrive8", showDrive8);
      for (var i = 1; i < maxDrive + 1; i ++ ){
        drive[i] = inifile.ReadLine();
        System.Gadget.Settings.write("drive" + i, drive[i]);
        alertLowDisk[i] = inifile.ReadLine();
        System.Gadget.Settings.write("alertLowDisk" + i, alertLowDisk[i]);
        alertLowDiskBelow[i] = inifile.ReadLine();
        System.Gadget.Settings.write("alertLowDiskBelow" + i, alertLowDiskBelow[i]);
        alertLowDiskByt[i] = inifile.ReadLine();
        System.Gadget.Settings.write("alertLowDiskByt" + i, alertLowDiskByt[i]);
        soundLowDisk[i] = inifile.ReadLine();
        System.Gadget.Settings.write("soundLowDisk" + i, soundLowDisk[i]);
        soundLowDiskurl[i] = inifile.ReadLine();
        System.Gadget.Settings.write("soundLowDiskurl" + i, soundLowDiskurl[i]);
        soundLowDiskVol[i] = inifile.ReadLine();
        System.Gadget.Settings.write("soundLowDiskVol" + i, soundLowDiskVol[i]);
        soundLowDiskRepeats[i] = inifile.ReadLine();
        System.Gadget.Settings.write("soundLowDiskRepeats" + i, soundLowDiskRepeats[i]);
        soundLowDiskCount[i] = inifile.ReadLine();
        System.Gadget.Settings.write("soundLowDiskCount" + i, soundLowDiskCount[i]);
        text[i] = inifile.ReadLine();
        System.Gadget.Settings.write("text" + i, text[i]);
        fixtext[i] = inifile.ReadLine();
        System.Gadget.Settings.write("fixtext" + i, fixtext[i]);
        percent[i] = inifile.ReadLine();
        System.Gadget.Settings.write("percent" + i, percent[i]);
        fixpercent[i] = inifile.ReadLine();
        System.Gadget.Settings.write("fixpercent" + i, fixpercent[i]);
        bar[i] = inifile.ReadLine();
        System.Gadget.Settings.write("bar" + i, bar[i]);
        fixbar[i] = inifile.ReadLine();
        System.Gadget.Settings.write("fixbar" + i, fixbar[i]);
        read[i] = inifile.ReadLine();
        System.Gadget.Settings.write("read" + i, read[i]);
        fixread[i] = inifile.ReadLine();
        System.Gadget.Settings.write("fixread" + i, fixread[i]);
        cWrite[i] = inifile.ReadLine();
        System.Gadget.Settings.write("write" + i, cWrite[i]);
        fixwrite[i] = inifile.ReadLine();
        System.Gadget.Settings.write("fixwrite" + i, fixwrite[i]);
      }
      allDiskActivity = inifile.ReadLine();
      System.Gadget.Settings.write("allDiskActivity", allDiskActivity);
      FlyoutBac = inifile.ReadLine();
      System.Gadget.Settings.write("FlyoutBac", FlyoutBac);
      fixFlyoutBac = inifile.ReadLine();
      System.Gadget.Settings.write("fixFlyoutBac", fixFlyoutBac);
      FlyoutTit = inifile.ReadLine();
      System.Gadget.Settings.write("FlyoutTit", FlyoutTit);
      fixFlyoutTit = inifile.ReadLine();
      System.Gadget.Settings.write("fixFlyoutTit", fixFlyoutTit);
      FlyoutDet = inifile.ReadLine();
      System.Gadget.Settings.write("FlyoutDet", FlyoutDet);
      fixFlyoutDet = inifile.ReadLine();
      System.Gadget.Settings.write("fixFlyoutDet", fixFlyoutDet);
    }
    finally{
      inifile.Close();
    }
  }
  catch (err){
  }
  var Startup = 1;
  System.Gadget.Settings.write("Startup", Startup);
  loadSettings();
}
function setonTimer(){
  settimer = System.Gadget.Settings.read("settimer");
  if (settimer != "");
  else settimer = "1";
  clearDriveUpdate = setInterval("driveUpdate()", parseInt(settimer * 1000));
}
function ejectDrive1(){
  var loadEjectDrive = drive[1] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive2(){
  var loadEjectDrive = drive[2] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive3(){
  var loadEjectDrive = drive[3] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive4(){
  var loadEjectDrive = drive[4] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive5(){
  var loadEjectDrive = drive[5] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive6(){
  var loadEjectDrive = drive[6] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive7(){
  var loadEjectDrive = drive[7] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function ejectDrive8(){
  var loadEjectDrive = drive[8] + ":\\";
  try {
    shell.NameSpace(17).ParseName(loadEjectDrive).InvokeVerb("Eject")
  }
  catch (err){
  }
}
function driveUpdate(){
  for (var i = 1; i < totalDrive + 1; i ++ ){
    try {
      ldDriveType[i] = System.Shell.drive(drive[i]).driveType;
    }
    catch (err){
      ldDriveType[i] = 3;
    }
    O('sdrive' + i).innerHTML = drive[i] + ":";
    if (ldDriveType[i] == 5){
      try {
        ldVolumeName[i] = System.Shell.drive(drive[i]).volumeLabel;
        ldFreeSpace[i] = Number(System.Shell.drive(drive[i]).freeSpace);
        ldSize[i] = Number(System.Shell.drive(drive[i]).totalSize);
      }
      catch (err){
        ldVolumeName[i] = "EMPTY";
        ldFreeSpace[i] = 0;
        ldSize[i] = 0;
      }
      alertLowDisk[i] = 2;
      O('sdriveVolume' + i).innerHTML = ldVolumeName[i];
      O('sdriveUsed' + i).innerHTML = "Used: " + formatHDMBytes(ldSize[i] - ldFreeSpace[i
      ]) + "B";
      O('sdriveFree' + i).innerHTML = "Free: " + formatHDMBytes(ldFreeSpace[i]) + "B";
      O('sdriveTotal' + i).innerHTML = "Total: " + formatHDMBytes(ldSize[i]) + "B";
      if (showDrive[i] == 2){
        O('ejectImg' + i).style.visibility = "visible";
      }
      else {
        O('ejectImg' + i).style.visibility = "hidden";
      }
    }
    else {
      if (ldDriveType[i] == 2){
        if (showDrive[i] == 2){
          O('ejectImg' + i).style.visibility = "visible";
        }
        else {
          O('ejectImg' + i).style.visibility = "hidden";
        }
      }
      else {
        O('ejectImg' + i).style.visibility = "hidden";
      }
      var checkDrive = System.Shell.drive(drive[i]);
      if (checkDrive){
        if (skipDrive[i] == 1){
          if (checkDrive.isReady){
            try {
              ldVolumeName[i] = System.Shell.drive(drive[i]).volumeLabel;
              ldFreeSpace[i] = Number(System.Shell.drive(drive[i]).freeSpace);
              ldSize[i] = Number(System.Shell.drive(drive[i]).totalSize);
            }
            catch (err){
              ldVolumeName[i] = "EMPTY";
              ldFreeSpace[i] = 0;
              ldSize[i] = 0;
            }
            O('sdriveVolume' + i).innerHTML = ldVolumeName[i];
            O('sdriveUsed' + i).innerHTML = "Used: " + formatHDMBytes(ldSize[i] - 
            ldFreeSpace[i]) + "B";
            O('sdriveFree' + i).innerHTML = "Free: " + formatHDMBytes(ldFreeSpace[i]) + 
            "B";
            O('sdriveTotal' + i).innerHTML = "Total: " + formatHDMBytes(ldSize[i]) + "B";
            O('sdriveBar' + i).style.width = parseInt(0.5 * secFormat((ldSize[i] - 
            ldFreeSpace[i]) / ldSize[i] * 100) * size);
            O('sdriveBar' + i).style.visibility = "visible";
            if (allDiskActivity == 1){
              lastgetDiskRead[i] = getDiskRead[i];
              lastgetDiskWrite[i] = getDiskWrite[i];
              lastgetPercentDisk[i] = getPercentDisk[i];
              try {
                var getValue = objService.ExecQuery("SELECT DiskReadBytesPerSec,DiskWriteBytesPerSec,PercentDiskTime FROM Win32_PerfRawData_PerfDisk_LogicalDisk Where Name=" + "'" + drive[i] + ":'" + "");
                getDiskRead[i] = Number((new Enumerator(getValue)).item().
                DiskReadBytesPerSec);
                getDiskWrite[i] = Number((new Enumerator(getValue)).item().
                DiskWriteBytesPerSec);
                getPercentDisk[i] = Number((new Enumerator(getValue)).item().
                PercentDiskTime);
              }
              catch (err){
              }
              diskReadBPS[i] = parseInt((getDiskRead[i] - lastgetDiskRead[i]) / settimer);
              diskWriteBPS[i] = parseInt((getDiskWrite[i] - lastgetDiskWrite[i]) / 
              settimer);
              percentDT[i] = Math.round((getPercentDisk[i] - lastgetPercentDisk[i]) / 
              100000);
              if (percentDT[i] >= 100){
                percentDT[i] = 100;
              }
              O('sDrivePrec' + i).innerHTML = percentDT[i] + "%";
              if (fixUnit == 1){
                O('diskRead' + i).innerHTML = formatBytes(diskReadBPS[i]) + "B/s";
                O('diskWrite' + i).innerHTML = formatBytes(diskWriteBPS[i]) + "B/s";
              }
              else if (fixUnit == 2){
                O('diskRead' + i).innerHTML = formatKBytes(diskReadBPS[i]) + "B/s";
                O('diskWrite' + i).innerHTML = formatKBytes(diskWriteBPS[i]) + "B/s";
              }
              else if (fixUnit == 3){
                O('diskRead' + i).innerHTML = formatMBytes(diskReadBPS[i]) + "B/s";
                O('diskWrite' + i).innerHTML = formatMBytes(diskWriteBPS[i]) + "B/s";
              }
            }
          }
          else {
            diskReadBPS[i] = 0;
            diskWriteBPS[i] = 0;
            percentDT[i] = 0;
            O('sdriveVolume' + i).innerHTML = "Safely Removed";
            O('sDrivePrec' + i).innerHTML = "0%";
            O('sdriveUsed' + i).innerHTML = "Used: ----";
            O('sdriveFree' + i).innerHTML = "Free: ----";
            O('sdriveTotal' + i).innerHTML = "Total: ----";
            O('sdriveBar' + i).style.visibility = "hidden";
            skipDrive[i] = 2;
          }
        }
      }
      else {
        diskReadBPS[i] = 0;
        diskWriteBPS[i] = 0;
        percentDT[i] = 0;
        O('sdriveVolume' + i).innerHTML = "EMPTY";
        O('sDrivePrec' + i).innerHTML = "0%";
        O('sdriveUsed' + i).innerHTML = "Used: ----";
        O('sdriveFree' + i).innerHTML = "Free: ----";
        O('sdriveTotal' + i).innerHTML = "Total: ----";
        O('sdriveBar' + i).style.visibility = "hidden";
        skipDrive[i] = 1;
      }
    }
  }
  if (graph == 1){
    if (allDiskActivity == 1){
      updateGraph();
      updateGraphPer();
      updateNetVars();
    }
  }
  soundAlert();
}
function soundAlert(){
  if (alertDrive == 1){
    for (var t = 1; t < totalDrive + 1; t ++ ){
      if (System.Shell.drive(drive[t])){
        if (alertLowDisk[t] == 1){
          if (ldFreeSpace[t] <= LowDiskbyt[t]){
            if (Player.controls.isAvailable('Stop')){
            }
            else {
              if (soundLowDisk[t] == 50){
                Player.URL = soundLowDiskurl[t];
                Player.settings.volume = soundLowDiskVol[t];
                Player.Controls.play();
                if (soundLowDiskRepeats[t] == 1){
                  Player.Settings.setMode("loop", true)
                }
                else if (soundLowDiskRepeats[t] == 3){
                  Player.Settings.playCount = soundLowDiskCount[t];
                }
                alertIconRed();
              }
              else {
                Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk[t] + ".mp3";
                Player.settings.volume = soundLowDiskVol[t];
                Player.Controls.play();
                if (soundLowDiskRepeats[t] == 1){
                  Player.Settings.setMode("loop", true)
                }
                else if (soundLowDiskRepeats[t] == 3){
                  Player.Settings.playCount = soundLowDiskCount[t];
                }
                alertIconRed();
              }
            }
          }
        }
      }
    }
  }
}
function alertIconRed(){
  if (Player.controls.isAvailable('Stop')){
    O('iconAlert').style.color = "#ff0033";
    setTimeout("alertIconGreen()", 500);
  }
}
function alertIconGreen(){
  O('iconAlert').style.color = sAlertIcon;
  setTimeout("alertIconRed()", 500);
}
function clickAlert(){
  if (alertDrive == 1){
    if (Player.controls.isAvailable('Stop')){
      Player.controls.stop();
    }
    else {
      O('iconAlert').style.color = "#808080";
      alertDrive = "2";
      System.Gadget.Settings.write("alertDrive", 2);
    }
  }
  else {
    O('iconAlert').style.color = sAlertIcon;
    alertDrive = "1";
    System.Gadget.Settings.write("alertDrive", 1);
  }
}
function updateNetVars(){
  for (var i = 1; i < totalDrive + 1; i ++ ){
    if (diskWriteBPS[i] < 0){
      diskWriteBPS[i] = 0;
    }
    if (diskReadBPS[i] < 0){
      diskReadBPS[i] = 0;
    }
    if (percentDT[i] <= 0){
      percentDT[i] = 0;
    }
    if (writeHist[i].push(diskWriteBPS[i]) > maxHist){
      writeHist[i].shift();
    }
    if (readHist[i].push(diskReadBPS[i]) > maxHist){
      readHist[i].shift();
    }
    if (perHist[i].push(percentDT[i]) > maxHistPer){
      perHist[i].shift();
    }
  }
}
function initHist(){
  for (var t = 1; t < totalDrive + 1; t ++ ){
    for (var i = 0; i < maxHist; i ++ ){
      readHist[t][i] = 0;
      writeHist[t][i] = 0;
    }
  }
}
function initHistPer(){
  for (var t = 1; t < totalDrive + 1; t ++ ){
    for (var i = 0; i < maxHistPer; i ++ ){
      perHist[t][i] = 0;
    }
  }
}
function getMaxValue(){
  var max = 0;
  for (var t = 1; t < totalDrive + 1; t ++ ){
    for (var i = 0; i < maxHist; i ++ ){
      if (readHist[t][i] > max)max = readHist[t][i];
      if (writeHist[t][i] > max)max = writeHist[t][i];
    }
    return max;
  }
}
function updateGraph(){
  var param = "";
  var max = 0;
  var v_max = getMaxValue();
  max = scalesize * 1024;
  if ((v_max > max) || (scaletype == 0)){
    max = v_max;
  }
  else {
    max = scalesize * 1024;
  }
  for (var t = 1; t < totalDrive + 1; t ++ ){
    writepath[t] = "m 0,30 ";
    readpath[t] = "m 0,30 ";
    rb[t] = 0;
    wb[t] = 0;
    for (var i = 0; i < maxHist; i ++ ){
      rb[t] = parseInt(30 / (max / readHist[t][i]));
      wb[t] = parseInt(30 / (max / writeHist[t][i]));
      if (rb[t] > 30){
        rb[t] = 30;
      }
      if (wb[t] > 30){
        wb[t] = 30;
      }
      if (drawstyle == 1){
        param = (rb[t] == 0) ? "m" : "l";
        readpath[t] += " m " + parseInt(i + 1) + ",30 " + param + " " + parseInt(i + 1) + 
        "," + parseInt(30 - (rb[t])) + "";
        param = (wb[t] == 0) ? "m" : "l";
        writepath[t] += " m " + parseInt(i + 1) + ",30 " + param + " " + parseInt(i + 1) + 
        "," + parseInt(30 - (wb[t])) + "";
      }
      else {
        readpath[t] += " l " + parseInt(i + 1) + "," + parseInt(30 - (rb[t]));
        writepath[t] += " l " + parseInt(i + 1) + "," + parseInt(30 - (wb[t]));
      }
    }
  }
  for (var t = 1; t < totalDrive + 1; t ++ ){
    readpath[t] = readpath[t] + " e";
    writepath[t] = writepath[t] + " e";
    O('writegraph' + t).path = writepath[t];
    O('readgraph' + t).path = readpath[t];
  }
}
function updateGraphPer(){
  for (var t = 1; t < totalDrive + 1; t ++ ){
    ppath[t] = "m 0,100 ";
    p[t] = 0;
    for (var i = 0; i < maxHistPer; i ++ ){
      p[t] = parseInt(perHist[t][i]);
      if (drawstyle == 1){
        param = (p[t] == 0) ? "m" : "l";
        ppath[t] += " m " + parseInt(i + 1) + ",100 " + param + " " + parseInt(i + 1) + 
        "," + parseInt(100 - (p[t])) + "";
      }
      else {
        ppath[t] += " l " + parseInt(i + 1) + "," + parseInt(100 - (p[t]));
      }
    }
    ppath[t] = ppath[t] + " e";
    O('pergraph' + t).path = ppath[t];
  }
}
function formatHDMBytes(mb){
  if (mb > 1048576)return fourdigits((mb / 1024) / 1024) + "T";
  if (mb > 1024)return fourdigits(mb / 1024) + "G";
  return fourdigits(mb) + "M";
}
function secFormat(mb){
  if (mb > 0)return twodigits(mb / 1);
  return twodigits(mb);
}
function fourdigits(val){
  if (val > 1000)return val.toFixed(0);
  else if (val > 100)return val.toFixed(1);
  else if (val > 10)return val.toFixed(2);
  else return val.toFixed(3);
}
function formatBytes(bytes){
  if (bytes > 1125899906842624)return fourdigits(((((bytes / 1024) / 1024) / 1024) / 1024)
   / 1024) + "P";
  if (bytes > 1099511627776)return fourdigits((((bytes / 1024) / 1024) / 1024) / 1024) + 
  "T";
  if (bytes > 1073741824)return fourdigits(((bytes / 1024) / 1024) / 1024) + "G";
  if (bytes > 1048576)return fourdigits((bytes / 1024) / 1024) + "M";
  if (bytes > 1024)return fourdigits(bytes / 1024) + "k";
  return fourdigits(bytes);
}
function formatKBytes(bytes){
  if (bytes > 1125899906842624)return fourdigits(((((bytes / 1024) / 1024) / 1024) / 1024)
   / 1024) + "P";
  if (bytes > 1099511627776)return fourdigits((((bytes / 1024) / 1024) / 1024) / 1024) + 
  "T";
  if (bytes > 1073741824)return fourdigits(((bytes / 1024) / 1024) / 1024) + "G";
  if (bytes > 1048576)return fourdigits((bytes / 1024) / 1024) + "M";
  return fourdigits(bytes / 1024) + "k";
}
function formatMBytes(bytes){
  if (bytes > 1125899906842624)return fourdigits(((((bytes / 1024) / 1024) / 1024) / 1024)
   / 1024) + "P";
  if (bytes > 1099511627776)return fourdigits((((bytes / 1024) / 1024) / 1024) / 1024) + 
  "T";
  if (bytes > 1073741824)return fourdigits(((bytes / 1024) / 1024) / 1024) + "G";
  return fourdigits((bytes / 1024) / 1024) + "M";
}
function twodigits(val){
  return val.toFixed(0);
}
function sizeMode(){
  if (showDrive[8] == 2){
    totalDrive = 8;
  }
  else if (showDrive[7] == 2){
    totalDrive = 7;
  }
  else if (showDrive[6] == 2){
    totalDrive = 6;
  }
  else if (showDrive[5] == 2){
    totalDrive = 5;
  }
  else if (showDrive[4] == 2){
    totalDrive = 4;
  }
  else if (showDrive[3] == 2){
    totalDrive = 3;
  }
  else if (showDrive[2] == 2){
    totalDrive = 2;
  }
  else {
    totalDrive = 1;
  }
  if (graph == 2){
    sizegraph = 35;
    O('linesx').style.visibility = "hidden";
    O('linesy').style.visibility = "hidden";
    O('border').style.visibility = "hidden";
    for (var i = 1; i < maxDrive + 1; i ++ ){
      O('writegraph' + i).style.visibility = "hidden";
      O('readgraph' + i).style.visibility = "hidden";
      O('pergraph' + i).style.visibility = "hidden";
    }
  }
  else {
    if (allDiskActivity == 2){
      sizegraph = 35;
      O('linesx').style.visibility = "hidden";
      O('linesy').style.visibility = "hidden";
      O('border').style.visibility = "hidden";
      for (var i = 1; i < maxDrive + 1; i ++ ){
        O('writegraph' + i).style.visibility = "hidden";
        O('readgraph' + i).style.visibility = "hidden";
        O('pergraph' + i).style.visibility = "hidden";
      }
    }
    else {
      sizegraph = 0;
      O('linesx').style.visibility = "visible";
      O('linesy').style.visibility = "visible";
      O('border').style.visibility = "visible";
      for (var i = 1; i < maxDrive + 1; i ++ ){
        O('writegraph' + i).style.visibility = "visible";
        O('readgraph' + i).style.visibility = "visible";
        O('pergraph' + i).style.visibility = "visible";
      }
    }
  }
  for (var i = 1; i < maxDrive + 1; i ++ ){
    if (showDrive[i] == 1){
      O('sDrive' + i).style.visibility = "hidden";
      O('sDriveVolume' + i).style.visibility = "hidden";
      O('sDrivePrec' + i).style.visibility = "hidden";
      O('sDriveUsed' + i).style.visibility = "hidden";
      O('sDriveFree' + i).style.visibility = "hidden";
      O('sDriveTotal' + i).style.visibility = "hidden";
      O('sDriveBar' + i).style.visibility = "hidden";
      O('usedBlackBar' + i).style.visibility = "hidden";
      O('usedTopBar' + i).style.visibility = "hidden";
      O('diskRead' + i).style.visibility = "hidden";
      O('diskWrite' + i).style.visibility = "hidden";
      O('arrowup' + i).style.visibility = "hidden";
      O('arrowdown' + i).style.visibility = "hidden";
    }
    else {
      if (allDiskActivity == 2){
        O('sDrivePrec' + i).style.visibility = "hidden";
        O('diskRead' + i).style.visibility = "hidden";
        O('diskWrite' + i).style.visibility = "hidden";
        O('arrowup' + i).style.visibility = "hidden";
        O('arrowdown' + i).style.visibility = "hidden";
      }
      else {
        O('sDrivePrec' + i).style.visibility = "visible";
        O('diskRead' + i).style.visibility = "visible";
        O('diskWrite' + i).style.visibility = "visible";
        O('arrowup' + i).style.visibility = "visible";
        O('arrowdown' + i).style.visibility = "visible";
      }
      O('sDrive' + i).style.visibility = "visible";
      O('sDriveVolume' + i).style.visibility = "visible";
      O('sDriveUsed' + i).style.visibility = "visible";
      O('sDriveFree' + i).style.visibility = "visible";
      O('sDriveTotal' + i).style.visibility = "visible";
      O('sDriveBar' + i).style.visibility = "visible";
      O('usedBlackBar' + i).style.visibility = "visible";
      O('usedTopBar' + i).style.visibility = "visible";
      O('hr' + i).style.visibility = "visible";
    }
  }
  for (var i = 1; i < maxDrive + 1; i ++ ){
    if (totalDrive == i){
      O('hr' + i).style.visibility = "hidden";
    }
  }
  if (allDiskActivity == 2){
    background.src = "images/" + "back_s" + totalDrive + ".png";
    document.body.style.height = Math.round(((90 - sizegraph + sizeUpdate) + ((totalDrive - 
    1) * 33)) * size);
    O('background').style.height = Math.round(((90 - sizegraph + sizeUpdate) + ((
    totalDrive - 1) * 33)) * size);
    allHeight = parseInt((90 - sizegraph + sizeUpdate) + ((totalDrive - 1) * 33));
  }
  else {
    background.src = "images/" + "back_" + totalDrive + ".png";
    document.body.style.height = Math.round(((102 - sizegraph + sizeUpdate) + ((totalDrive
     - 1) * 43)) * size);
    O('background').style.height = Math.round(((102 - sizegraph + sizeUpdate) + ((
    totalDrive - 1) * 43)) * size);
    allHeight = parseInt((102 - sizegraph + sizeUpdate) + ((totalDrive - 1) * 43));
  }
  gleft = parseInt(7 * size);
  gwidth = parseInt(116 * size);
  gheight = parseInt(30 * size);
  document.body.style.fontSize = parseInt(9 * size);
  document.body.style.width = Math.round(130 * size);
  O('background').style.width = Math.round(130 * size);
  O('backgc').style.background = sBackg;
  O('backgc').style.top = Math.round(3 * size);
  O('backgc').style.left = Math.round(3 * size);
  O('backgc').style.width = Math.round(124 * size);
  O('backgc').style.height = Math.round((allHeight - 6) * size);
  O('blackwhite').style.top = Math.round(3 * size);
  O('blackwhite').style.left = Math.round(3 * size);
  O('blackwhite').style.width = Math.round(124 * size);
  O('blackwhite').style.height = Math.round((allHeight - 6) * size);
  O('drive').style.color = sTitle;
  if (alertDrive == 1){
    O('iconAlert').style.color = sAlertIcon;
  }
  else if (alertDrive == 2){
    O('iconAlert').style.color = "#808080";
  }
  O('iconAlert').innerHTML = "&#9834;";
  O('iconAlert').style.top = parseInt(1 * size);
  O('iconAlert').style.right = parseInt(7 * size);
  O('iconAlert').style.fontSize = parseInt(16 * size);
  O('driveIcon').style.top = parseInt(4 * size);
  O('driveIcon').style.left = parseInt(7 * size);
  O('driveIcon').style.width = parseInt(16 * size);
  O('driveIcon').style.height = parseInt(16 * size);
  O('drive').style.top = parseInt(4 * size);
  O('drive').style.left = parseInt(28 * size);
  O('drive').style.fontSize = parseInt(12 * size);
  for (var i = 1; i < totalDrive + 1; i ++ ){
    if (allDiskActivity == 2){
      O('sdrive' + i).style.top = parseInt((((i - 1) * 33) + 20) * size);
      O('sdriveVolume' + i).style.top = parseInt((((i - 1) * 33) + 20) * size);
      O('ejectImg' + i).style.top = parseInt((((i - 1) * 33) + 23) * size);
      O('sdriveUsed' + i).style.top = parseInt((((i - 1) * 33) + 30) * size);
      O('sdriveTotal' + i).style.top = parseInt((((i - 1) * 33) + 40) * size);
      O('sdriveFree' + i).style.top = parseInt((((i - 1) * 33) + 30) * size);
      O('diskRead' + i).style.top = parseInt((((i - 1) * 33) + 50) * size);
      O('diskWrite' + i).style.top = parseInt((((i - 1) * 33) + 50) * size);
      O('sDrivePrec' + i).style.top = parseInt((((i - 1) * 33) + 20) * size);
      O('sdriveBar' + i).style.top = parseInt((((i - 1) * 33) + 44) * size);
      O('usedBlackBar' + i).style.top = parseInt((((i - 1) * 33) + 44) * size);
      O('usedTopBar' + i).style.top = parseInt((((i - 1) * 33) + 44) * size);
      O('arrowup' + i).style.top = parseInt((((i - 1) * 33) + 49) * size);
      O('arrowdown' + i).style.top = parseInt((((i - 1) * 33) + 49) * size);
      O('hr' + i).style.top = parseInt((((i - 1) * 33) + 41) * size);
      O('newUpdate').style.top = parseInt(((85 - sizegraph) + ((totalDrive - 1) * 33)) * 
      size);
    }
    else {
      O('sdrive' + i).style.top = parseInt((((i - 1) * 43) + 20) * size);
      O('sdriveVolume' + i).style.top = parseInt((((i - 1) * 43) + 20) * size);
      O('ejectImg' + i).style.top = parseInt((((i - 1) * 43) + 23) * size);
      O('sdriveUsed' + i).style.top = parseInt((((i - 1) * 43) + 30) * size);
      O('sdriveTotal' + i).style.top = parseInt((((i - 1) * 43) + 40) * size);
      O('sdriveFree' + i).style.top = parseInt((((i - 1) * 43) + 30) * size);
      O('diskRead' + i).style.top = parseInt((((i - 1) * 43) + 50) * size);
      O('diskWrite' + i).style.top = parseInt((((i - 1) * 43) + 50) * size);
      O('sDrivePrec' + i).style.top = parseInt((((i - 1) * 43) + 20) * size);
      O('sdriveBar' + i).style.top = parseInt((((i - 1) * 43) + 44) * size);
      O('usedBlackBar' + i).style.top = parseInt((((i - 1) * 43) + 44) * size);
      O('usedTopBar' + i).style.top = parseInt((((i - 1) * 43) + 44) * size);
      O('arrowup' + i).style.top = parseInt((((i - 1) * 43) + 49) * size);
      O('arrowdown' + i).style.top = parseInt((((i - 1) * 43) + 49) * size);
      O('hr' + i).style.top = parseInt((((i - 1) * 43) + 51) * size);
      O('writegraph' + i).style.top = parseInt((64 + ((totalDrive - 1) * 43)) * size);
      O('readgraph' + i).style.top = parseInt((64 + ((totalDrive - 1) * 43)) * size);
      O('pergraph' + i).style.top = parseInt((64 + ((totalDrive - 1) * 43)) * size);
      O('newUpdate').style.top = parseInt(((95 - sizegraph) + ((totalDrive - 1) * 43)) * 
      size);
    }
    O('writegraph' + i).style.left = gleft;
    O('readgraph' + i).style.left = gleft;
    O('pergraph' + i).style.left = gleft;
    O('writegraph' + i).style.width = gwidth;
    O('readgraph' + i).style.width = gwidth;
    O('pergraph' + i).style.width = gwidth;
    O('writegraph' + i).style.height = gheight;
    O('readgraph' + i).style.height = gheight;
    O('pergraph' + i).style.height = gheight;
    O('sdriveBar' + i).style.visibility = "hidden";
    O('sdrive' + i).style.color = stext[i];
    O('sdriveVolume' + i).style.color = stext[i];
    O('sdriveUsed' + i).style.color = stext[i];
    O('sdriveFree' + i).style.color = stext[i];
    O('sdriveTotal' + i).style.color = stext[i];
    O('sDrivePrec' + i).style.color = spercent[i];
    O('sdriveBar' + i).style.color = sbar[i];
    O('pergraph' + i).strokecolor = spercent[i];
    O('pergraph' + i).fillcolor = spercent[i];
    O('diskRead' + i).style.color = sread[i];
    O('readgraph' + i).strokecolor = sread[i];
    O('readgraph' + i).fillcolor = sread[i];
    O('diskWrite' + i).style.color = swrite[i];
    O('writegraph' + i).strokecolor = swrite[i];
    O('writegraph' + i).fillcolor = swrite[i];
    O('sdrive' + i).style.left = parseInt(5 * size);
    O('sdriveVolume' + i).style.left = parseInt(15 * size);
    O('sdriveVolume' + i).style.width = parseInt(90 * size);
    O('ejectImg' + i).style.left = parseInt(94 * size);
    O('ejectImg' + i).style.width = parseInt(9 * size);
    O('ejectImg' + i).style.height = parseInt(9 * size);
    O('sdriveUsed' + i).style.left = parseInt(5 * size);
    O('sdriveTotal' + i).style.left = parseInt(5 * size);
    O('sdriveFree' + i).style.left = parseInt(71 * size);
    O('diskRead' + i).style.left = parseInt(15 * size);
    O('diskWrite' + i).style.left = parseInt(80 * size);
    O('sDrivePrec' + i).style.right = parseInt(5 * size);
    O('sdriveBar' + i).style.left = parseInt(71 * size);
    O('sdriveBar' + i).style.height = parseInt(6 * size);
    O('usedBlackBar' + i).style.left = parseInt(71 * size);
    O('usedBlackBar' + i).style.width = parseInt(50 * size);
    O('usedBlackBar' + i).style.height = parseInt(6 * size);
    O('usedTopBar' + i).style.left = parseInt(71 * size);
    O('usedTopBar' + i).style.width = parseInt(50 * size);
    O('usedTopBar' + i).style.height = parseInt(6 * size);
    O('arrowup' + i).style.left = parseInt(2 * size);
    O('arrowup' + i).style.width = parseInt(16 * size);
    O('arrowup' + i).style.height = parseInt(16 * size);
    O('arrowdown' + i).style.left = parseInt(67 * size);
    O('arrowdown' + i).style.width = parseInt(16 * size);
    O('arrowdown' + i).style.height = parseInt(16 * size);
    O('hr' + i).style.left = parseInt(7 * size);
    O('hr' + i).style.width = parseInt(116 * size);
  }
  O('newUpdate').style.left = parseInt(15 * size);
  O('newUpdate').style.width = parseInt(120 * size);
  O('newUpdate').style.color = "#FF0000";
  O('linesx').style.top = parseInt((64 + ((totalDrive - 1) * 43)) * size);
  O('linesy').style.top = parseInt((64 + ((totalDrive - 1) * 43)) * size);
  O('border').style.top = parseInt((63 + ((totalDrive - 1) * 43)) * size);
  O('linesx').style.left = gleft;
  O('linesy').style.left = gleft;
  O('border').style.left = gleft;
  O('linesx').style.width = gwidth;
  O('linesy').style.width = gwidth;
  O('border').style.width = gwidth+1;
  O('linesx').style.height = parseInt(30 * size);
  O('linesy').style.height = parseInt(30 * size);
  O('border').style.height = parseInt(31 * size)+1;
}
function dblclick(){
  System.Shell.execute("explorer.exe", "/n,");
}
function getURL(a){
  try {
    var xmlReq = new ActiveXObject("Microsoft.XMLHTTP");
    xmlReq.open("GET", a, false);
    xmlReq.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2000 00:00:00 GMT");
    xmlReq.send();
    if (xmlReq.status == 200){
      return xmlReq.responseText
    }
    else {
      return false
    }
  }
  catch (urlData){
    setTimeout("showUpdate2()", 600000);
  }
}
function updateAvailable(){
  var urlData = getURL("http://addgadgets.com/drives_meter/version.htm");
  if (urlData === false){
    return false
  }
  var version = "4.3";
  var a = parseFloat(version);
  var b = parseFloat(urlData);
  return b > a;
}
function showUpdate2(){
  if (updateAvailable()){
    O('newUpdate').style.visibility = "visible";
    O('newUpdate').innerHTML = "New version is available";
    sizeUpdate = 10;
    sizeMode();
  }
}
function timedMsg(){
  if (update == 1){
    setTimeout("showUpdate2()", 60000);
  }
  else if (update == 2){
    sizeUpdate = 0;
    O('newUpdate').style.visibility = "hidden";
    sizeMode();
  }
}
function show_flyout(){
  System.Gadget.Flyout.file = "flyout.html";
  System.Gadget.Flyout.show = true;
}