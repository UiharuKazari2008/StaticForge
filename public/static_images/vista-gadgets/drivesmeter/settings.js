nsp = 'Old browser!';
dl = document.layers;
oe = window.opera ? 1 : 0;
da = document.all &&! oe;
ge = document.getElementById;
ws = window.sidebar ? true : false;
tN = "mozilla/4.0 (compatible; msie 7.0; windows nt 6.2; win64; x64; trident/7.0; .net4.0e; .net4.0c; .net clr 3.5.30729; .net clr 2.0.50727; .net clr 3.0.30729)";
izN = tN.indexOf('netscape') >= 0 ? true : false;
zis = tN.indexOf('msie 7') >= 0 ? true : false;
zis8 = tN.indexOf('msie 8') >= 0 ? true : false;
zis |= zis8;
if (ws &&! izN){
    quogl = 'iuy';
}
var msg = '';
function nem(){
    return true;
}
window.onerror = nem;
zOF = window.location.protocol.indexOf("file") !=- 1 ? true : false;
i7f = zis &&! zOF ? true : false;
var O = document.getElementById;
function onLoad(){
  initSettings();
  System.Gadget.onSettingsClosing = SettingsClosing;
}
function initSettings(){
  loadSetting();
  sizeSettings();
  graphSettings();
  soundSettingsLowDisk();
  soundLowDiskRepeatsSettings();
  soundSettingsLowDisk2();
  soundLowDiskRepeats2Settings();
  soundSettingsLowDisk3();
  soundLowDiskRepeats3Settings();
  soundSettingsLowDisk4();
  soundLowDiskRepeats4Settings();
  soundSettingsLowDisk5();
  soundLowDiskRepeats5Settings();
  soundSettingsLowDisk6();
  soundLowDiskRepeats6Settings();
  soundSettingsLowDisk7();
  soundLowDiskRepeats7Settings();
  soundSettingsLowDisk8();
  soundLowDiskRepeats8Settings();
  colorSettings();
  showColor();
  driveSettings();
}
function SettingsClosing(event){
  if (event.closeAction == event.Action.commit){
    CheckAndSetDrives();
    System.Gadget.Settings.write("showDrive2", showDrive2.value);
    System.Gadget.Settings.write("showDrive3", showDrive3.value);
    System.Gadget.Settings.write("showDrive4", showDrive4.value);
    System.Gadget.Settings.write("showDrive5", showDrive5.value);
    System.Gadget.Settings.write("showDrive6", showDrive6.value);
    System.Gadget.Settings.write("showDrive7", showDrive7.value);
    System.Gadget.Settings.write("showDrive8", showDrive8.value);
    System.Gadget.Settings.write("fixsize", fixsize.value);
    System.Gadget.Settings.write("ssize", ssize.value);
    if (fixsize.value == "Custom"){
      System.Gadget.Settings.write("size", ssize.value / 100);
    }
    else {
      System.Gadget.Settings.write("size", fixsize.value / 100)
    }
    System.Gadget.Settings.write("settimer", settimer.value);
    System.Gadget.Settings.write("graph", graph.value);
    System.Gadget.Settings.write("drawstyle", drawstyle.value);
    System.Gadget.Settings.write("scaletype", ScaleType.value);
    System.Gadget.Settings.write("scalesize", ScaleSize.value);
    System.Gadget.Settings.write("fixUnit", fixUnit.value);
    System.Gadget.Settings.write("update", update.value);
    System.Gadget.Settings.write("backg", "#" + backg.value);
    System.Gadget.Settings.write("fixBackg", fixBackg.value);
    System.Gadget.Settings.write("title", "#" + title.value);
    System.Gadget.Settings.write("fixTitle", fixTitle.value);
    System.Gadget.Settings.write("text1", "#" + text1.value);
    System.Gadget.Settings.write("fixtext1", fixtext1.value);
    System.Gadget.Settings.write("percent1", "#" + percent1.value);
    System.Gadget.Settings.write("fixpercent1", fixpercent1.value);
    System.Gadget.Settings.write("bar1", "#" + bar1.value);
    System.Gadget.Settings.write("fixbar1", fixbar1.value);
    System.Gadget.Settings.write("read1", "#" + read1.value);
    System.Gadget.Settings.write("fixread1", fixread1.value);
    System.Gadget.Settings.write("write1", "#" + write1.value);
    System.Gadget.Settings.write("fixwrite1", fixwrite1.value);
    System.Gadget.Settings.write("text2", "#" + text2.value);
    System.Gadget.Settings.write("fixtext2", fixtext2.value);
    System.Gadget.Settings.write("percent2", "#" + percent2.value);
    System.Gadget.Settings.write("fixpercent2", fixpercent2.value);
    System.Gadget.Settings.write("bar2", "#" + bar2.value);
    System.Gadget.Settings.write("fixbar2", fixbar2.value);
    System.Gadget.Settings.write("read2", "#" + read2.value);
    System.Gadget.Settings.write("fixread2", fixread2.value);
    System.Gadget.Settings.write("write2", "#" + write2.value);
    System.Gadget.Settings.write("fixwrite2", fixwrite2.value);
    System.Gadget.Settings.write("text3", "#" + text3.value);
    System.Gadget.Settings.write("fixtext3", fixtext3.value);
    System.Gadget.Settings.write("percent3", "#" + percent3.value);
    System.Gadget.Settings.write("fixpercent3", fixpercent3.value);
    System.Gadget.Settings.write("bar3", "#" + bar3.value);
    System.Gadget.Settings.write("fixbar3", fixbar3.value);
    System.Gadget.Settings.write("read3", "#" + read3.value);
    System.Gadget.Settings.write("fixread3", fixread3.value);
    System.Gadget.Settings.write("write3", "#" + write3.value);
    System.Gadget.Settings.write("fixwrite3", fixwrite3.value);
    System.Gadget.Settings.write("text4", "#" + text4.value);
    System.Gadget.Settings.write("fixtext4", fixtext4.value);
    System.Gadget.Settings.write("percent4", "#" + percent4.value);
    System.Gadget.Settings.write("fixpercent4", fixpercent4.value);
    System.Gadget.Settings.write("bar4", "#" + bar4.value);
    System.Gadget.Settings.write("fixbar4", fixbar4.value);
    System.Gadget.Settings.write("read4", "#" + read4.value);
    System.Gadget.Settings.write("fixread4", fixread4.value);
    System.Gadget.Settings.write("write4", "#" + write4.value);
    System.Gadget.Settings.write("fixwrite4", fixwrite4.value);
    System.Gadget.Settings.write("text5", "#" + text5.value);
    System.Gadget.Settings.write("fixtext5", fixtext5.value);
    System.Gadget.Settings.write("percent5", "#" + percent5.value);
    System.Gadget.Settings.write("fixpercent5", fixpercent5.value);
    System.Gadget.Settings.write("bar5", "#" + bar5.value);
    System.Gadget.Settings.write("fixbar5", fixbar5.value);
    System.Gadget.Settings.write("read5", "#" + read5.value);
    System.Gadget.Settings.write("fixread5", fixread5.value);
    System.Gadget.Settings.write("write5", "#" + write5.value);
    System.Gadget.Settings.write("fixwrite5", fixwrite5.value);
    System.Gadget.Settings.write("text6", "#" + text6.value);
    System.Gadget.Settings.write("fixtext6", fixtext6.value);
    System.Gadget.Settings.write("percent6", "#" + percent6.value);
    System.Gadget.Settings.write("fixpercent6", fixpercent6.value);
    System.Gadget.Settings.write("bar6", "#" + bar6.value);
    System.Gadget.Settings.write("fixbar6", fixbar6.value);
    System.Gadget.Settings.write("read6", "#" + read6.value);
    System.Gadget.Settings.write("fixread6", fixread6.value);
    System.Gadget.Settings.write("write6", "#" + write6.value);
    System.Gadget.Settings.write("fixwrite6", fixwrite6.value);
    System.Gadget.Settings.write("text7", "#" + text7.value);
    System.Gadget.Settings.write("fixtext7", fixtext7.value);
    System.Gadget.Settings.write("percent7", "#" + percent7.value);
    System.Gadget.Settings.write("fixpercent7", fixpercent7.value);
    System.Gadget.Settings.write("bar7", "#" + bar7.value);
    System.Gadget.Settings.write("fixbar7", fixbar7.value);
    System.Gadget.Settings.write("read7", "#" + read7.value);
    System.Gadget.Settings.write("fixread7", fixread7.value);
    System.Gadget.Settings.write("write7", "#" + write7.value);
    System.Gadget.Settings.write("fixwrite7", fixwrite7.value);
    System.Gadget.Settings.write("text8", "#" + text8.value);
    System.Gadget.Settings.write("fixtext8", fixtext8.value);
    System.Gadget.Settings.write("percent8", "#" + percent8.value);
    System.Gadget.Settings.write("fixpercent8", fixpercent8.value);
    System.Gadget.Settings.write("bar8", "#" + bar8.value);
    System.Gadget.Settings.write("fixbar8", fixbar8.value);
    System.Gadget.Settings.write("read8", "#" + read8.value);
    System.Gadget.Settings.write("fixread8", fixread8.value);
    System.Gadget.Settings.write("write8", "#" + write8.value);
    System.Gadget.Settings.write("fixwrite8", fixwrite8.value);
    System.Gadget.Settings.write("AlertIcon", "#" + AlertIcon.value);
    System.Gadget.Settings.write("fixAlertIcon", fixAlertIcon.value);
    System.Gadget.Settings.write("alertDrive", alertDrive.value);
    System.Gadget.Settings.write("alertLowDisk1", alertLowDisk1.value);
    System.Gadget.Settings.write("alertLowDiskBelow1", alertLowDiskBelow1.value);
    System.Gadget.Settings.write("alertLowDiskByt1", alertLowDiskByt1.value);
    System.Gadget.Settings.write("soundLowDisk1", soundLowDisk1.value);
    System.Gadget.Settings.write("soundLowDiskurl1", soundLowDiskurl1.innerText);
    System.Gadget.Settings.write("soundLowDiskVol1", soundLowDiskVol1.value);
    System.Gadget.Settings.write("soundLowDiskRepeats1", soundLowDiskRepeats1.value);
    System.Gadget.Settings.write("soundLowDiskCount1", soundLowDiskCount1.value);
    System.Gadget.Settings.write("alertLowDisk2", alertLowDisk2.value);
    System.Gadget.Settings.write("alertLowDiskBelow2", alertLowDiskBelow2.value);
    System.Gadget.Settings.write("alertLowDiskByt2", alertLowDiskByt2.value);
    System.Gadget.Settings.write("soundLowDisk2", soundLowDisk2.value);
    System.Gadget.Settings.write("soundLowDiskurl2", soundLowDiskurl2.innerText);
    System.Gadget.Settings.write("soundLowDiskVol2", soundLowDiskVol2.value);
    System.Gadget.Settings.write("soundLowDiskRepeats2", soundLowDiskRepeats2.value);
    System.Gadget.Settings.write("soundLowDiskCount2", soundLowDiskCount2.value);
    System.Gadget.Settings.write("alertLowDisk3", alertLowDisk3.value);
    System.Gadget.Settings.write("alertLowDiskBelow3", alertLowDiskBelow3.value);
    System.Gadget.Settings.write("alertLowDiskByt3", alertLowDiskByt3.value);
    System.Gadget.Settings.write("soundLowDisk3", soundLowDisk3.value);
    System.Gadget.Settings.write("soundLowDiskurl3", soundLowDiskurl3.innerText);
    System.Gadget.Settings.write("soundLowDiskVol3", soundLowDiskVol3.value);
    System.Gadget.Settings.write("soundLowDiskRepeats3", soundLowDiskRepeats3.value);
    System.Gadget.Settings.write("soundLowDiskCount3", soundLowDiskCount3.value);
    System.Gadget.Settings.write("alertLowDisk4", alertLowDisk4.value);
    System.Gadget.Settings.write("alertLowDiskBelow4", alertLowDiskBelow4.value);
    System.Gadget.Settings.write("alertLowDiskByt4", alertLowDiskByt4.value);
    System.Gadget.Settings.write("soundLowDisk4", soundLowDisk4.value);
    System.Gadget.Settings.write("soundLowDiskurl4", soundLowDiskurl4.innerText);
    System.Gadget.Settings.write("soundLowDiskVol4", soundLowDiskVol4.value);
    System.Gadget.Settings.write("soundLowDiskRepeats4", soundLowDiskRepeats4.value);
    System.Gadget.Settings.write("soundLowDiskCount4", soundLowDiskCount4.value);
    System.Gadget.Settings.write("alertLowDisk5", alertLowDisk5.value);
    System.Gadget.Settings.write("alertLowDiskBelow5", alertLowDiskBelow5.value);
    System.Gadget.Settings.write("alertLowDiskByt5", alertLowDiskByt5.value);
    System.Gadget.Settings.write("soundLowDisk5", soundLowDisk5.value);
    System.Gadget.Settings.write("soundLowDiskurl5", soundLowDiskurl5.innerText);
    System.Gadget.Settings.write("soundLowDiskVol5", soundLowDiskVol5.value);
    System.Gadget.Settings.write("soundLowDiskRepeats5", soundLowDiskRepeats5.value);
    System.Gadget.Settings.write("soundLowDiskCount5", soundLowDiskCount5.value);
    System.Gadget.Settings.write("alertLowDisk6", alertLowDisk6.value);
    System.Gadget.Settings.write("alertLowDiskBelow6", alertLowDiskBelow6.value);
    System.Gadget.Settings.write("alertLowDiskByt6", alertLowDiskByt6.value);
    System.Gadget.Settings.write("soundLowDisk6", soundLowDisk6.value);
    System.Gadget.Settings.write("soundLowDiskurl6", soundLowDiskurl6.innerText);
    System.Gadget.Settings.write("soundLowDiskVol6", soundLowDiskVol6.value);
    System.Gadget.Settings.write("soundLowDiskRepeats6", soundLowDiskRepeats6.value);
    System.Gadget.Settings.write("soundLowDiskCount6", soundLowDiskCount6.value);
    System.Gadget.Settings.write("alertLowDisk7", alertLowDisk7.value);
    System.Gadget.Settings.write("alertLowDiskBelow7", alertLowDiskBelow7.value);
    System.Gadget.Settings.write("alertLowDiskByt7", alertLowDiskByt7.value);
    System.Gadget.Settings.write("soundLowDisk7", soundLowDisk7.value);
    System.Gadget.Settings.write("soundLowDiskurl7", soundLowDiskurl7.innerText);
    System.Gadget.Settings.write("soundLowDiskVol7", soundLowDiskVol7.value);
    System.Gadget.Settings.write("soundLowDiskRepeats7", soundLowDiskRepeats7.value);
    System.Gadget.Settings.write("soundLowDiskCount7", soundLowDiskCount7.value);
    System.Gadget.Settings.write("alertLowDisk8", alertLowDisk8.value);
    System.Gadget.Settings.write("alertLowDiskBelow8", alertLowDiskBelow8.value);
    System.Gadget.Settings.write("alertLowDiskByt8", alertLowDiskByt8.value);
    System.Gadget.Settings.write("soundLowDisk8", soundLowDisk8.value);
    System.Gadget.Settings.write("soundLowDiskurl8", soundLowDiskurl8.innerText);
    System.Gadget.Settings.write("soundLowDiskVol8", soundLowDiskVol8.value);
    System.Gadget.Settings.write("soundLowDiskRepeats8", soundLowDiskRepeats8.value);
    System.Gadget.Settings.write("soundLowDiskCount8", soundLowDiskCount8.value);
    System.Gadget.Settings.write("allDiskActivity", allDiskActivity.value);
    System.Gadget.Settings.write("FlyoutBac", "#" + FlyoutBac.value);
    System.Gadget.Settings.write("fixFlyoutBac", fixFlyoutBac.value);
    System.Gadget.Settings.write("FlyoutTit", "#" + FlyoutTit.value);
    System.Gadget.Settings.write("fixFlyoutTit", fixFlyoutTit.value);
    System.Gadget.Settings.write("FlyoutDet", "#" + FlyoutDet.value);
    System.Gadget.Settings.write("fixFlyoutDet", fixFlyoutDet.value);
    savefilesettings();
  }
  event.cancel = false
}
function loadSetting(){
  gdrive1 = System.Gadget.Settings.read("drive1");
  if (gdrive1 != '')drive1.value = gdrive1;
  else drive1.value = 'C';
  gdrive2 = System.Gadget.Settings.read("drive2");
  if (gdrive2 != '')drive2.value = gdrive2;
  else drive2.value = 'D';
  gdrive3 = System.Gadget.Settings.read("drive3");
  if (gdrive3 != '')drive3.value = gdrive3;
  else drive3.value = 'E';
  gdrive4 = System.Gadget.Settings.read("drive4");
  if (gdrive4 != '')drive4.value = gdrive4;
  else drive4.value = 'F';
  gdrive5 = System.Gadget.Settings.read("drive5");
  if (gdrive5 != '')drive5.value = gdrive5;
  else drive5.value = 'G';
  gdrive6 = System.Gadget.Settings.read("drive6");
  if (gdrive6 != '')drive6.value = gdrive6;
  else drive6.value = 'H';
  gdrive7 = System.Gadget.Settings.read("drive7");
  if (gdrive7 != '')drive7.value = gdrive7;
  else drive7.value = 'I';
  gdrive8 = System.Gadget.Settings.read("drive8");
  if (gdrive8 != '')drive8.value = gdrive8;
  else drive8.value = 'J';
  gshowDrive2 = System.Gadget.Settings.read("showDrive2");
  if (gshowDrive2 != '')showDrive2.value = gshowDrive2;
  else showDrive2.value = '1';
  gshowDrive3 = System.Gadget.Settings.read("showDrive3");
  if (gshowDrive3 != '')showDrive3.value = gshowDrive3;
  else showDrive3.value = '1';
  gshowDrive4 = System.Gadget.Settings.read("showDrive4");
  if (gshowDrive4 != '')showDrive4.value = gshowDrive4;
  else showDrive4.value = '1';
  gshowDrive5 = System.Gadget.Settings.read("showDrive5");
  if (gshowDrive5 != '')showDrive5.value = gshowDrive5;
  else showDrive5.value = '1';
  gshowDrive6 = System.Gadget.Settings.read("showDrive6");
  if (gshowDrive6 != '')showDrive6.value = gshowDrive6;
  else showDrive6.value = '1';
  gshowDrive7 = System.Gadget.Settings.read("showDrive7");
  if (gshowDrive7 != '')showDrive7.value = gshowDrive7;
  else showDrive7.value = '1';
  gshowDrive8 = System.Gadget.Settings.read("showDrive8");
  if (gshowDrive8 != '')showDrive8.value = gshowDrive8;
  else showDrive8.value = '1';
  gfixsize = System.Gadget.Settings.read("fixsize");
  if (gfixsize != '')fixsize.value = gfixsize;
  else fixsize.value = '100';
  gssize = System.Gadget.Settings.read("ssize");
  if (gssize != '')ssize.value = gssize;
  else ssize.value = '100';
  gsettimer = System.Gadget.Settings.read("settimer");
  if (gsettimer != '')settimer.value = gsettimer;
  else settimer.value = '1';
  ggraph = System.Gadget.Settings.read("graph");
  if (ggraph != '')graph.value = ggraph;
  else graph.value = '1';
  gdrawstyle = System.Gadget.Settings.read("drawstyle");
  if (gdrawstyle != '')drawstyle.value = gdrawstyle;
  else drawstyle.value = '0';
  gScaleType = System.Gadget.Settings.read("scaletype");
  if (gScaleType != '')ScaleType.value = gScaleType;
  else ScaleType.value = '0';
  gScaleSize = System.Gadget.Settings.read("scalesize");
  if (gScaleSize != '')ScaleSize.value = gScaleSize;
  else ScaleSize.value = '';
  gfixUnit = System.Gadget.Settings.read("fixUnit");
  if (gfixUnit != '')fixUnit.value = gfixUnit;
  else fixUnit.value = '1';
  gupdate = System.Gadget.Settings.read("update");
  if (gupdate != '')update.value = gupdate;
  else update.value = '1';
  gbackg = System.Gadget.Settings.read("backg");
  if (gbackg != '')backg.value = gbackg;
  else backg.value = '080808';
  gfixBackg = System.Gadget.Settings.read("fixBackg");
  if (gfixBackg != '')fixBackg.value = gfixBackg;
  else fixBackg.value = '';
  gtitle = System.Gadget.Settings.read("title");
  if (gtitle != '')title.value = gtitle;
  else title.value = 'ffffff';
  gfixTitle = System.Gadget.Settings.read("fixTitle");
  if (gfixTitle != '')fixTitle.value = gfixTitle;
  else fixTitle.value = '';
  gtext1 = System.Gadget.Settings.read("text1");
  if (gtext1 != '')text1.value = gtext1;
  else text1.value = '87CEFA';
  gfixtext1 = System.Gadget.Settings.read("fixtext1");
  if (gfixtext1 != '')fixtext1.value = gfixtext1;
  else fixtext1.value = '';
  gpercent1 = System.Gadget.Settings.read("percent1");
  if (gpercent1 != '')percent1.value = gpercent1;
  else percent1.value = 'E5316C';
  gfixpercent1 = System.Gadget.Settings.read("fixpercent1");
  if (gfixpercent1 != '')fixpercent1.value = gfixpercent1;
  else fixpercent1.value = '';
  gbar1 = System.Gadget.Settings.read("bar1");
  if (gbar1 != '')bar1.value = gbar1;
  else bar1.value = 'FFF62A';
  gfixbar1 = System.Gadget.Settings.read("fixbar1");
  if (gfixbar1 != '')fixbar1.value = gfixbar1;
  else fixbar1.value = '';
  gread1 = System.Gadget.Settings.read("read1");
  if (gread1 != '')read1.value = gread1;
  else read1.value = '90EE90';
  gfixread1 = System.Gadget.Settings.read("fixread1");
  if (gfixread1 != '')fixread1.value = gfixread1;
  else fixread1.value = '';
  gwrite1 = System.Gadget.Settings.read("write1");
  if (gwrite1 != '')write1.value = gwrite1;
  else write1.value = 'FFF62A';
  gfixwrite1 = System.Gadget.Settings.read("fixwrite1");
  if (gfixwrite1 != '')fixwrite1.value = gfixwrite1;
  else fixwrite1.value = '';
  gtext2 = System.Gadget.Settings.read("text2");
  if (gtext2 != '')text2.value = gtext2;
  else text2.value = '87CEFA';
  gfixtext2 = System.Gadget.Settings.read("fixtext2");
  if (gfixtext2 != '')fixtext2.value = gfixtext2;
  else fixtext2.value = '';
  gpercent2 = System.Gadget.Settings.read("percent2");
  if (gpercent2 != '')percent2.value = gpercent2;
  else percent2.value = 'E2003B';
  gfixpercent2 = System.Gadget.Settings.read("fixpercent2");
  if (gfixpercent2 != '')fixpercent2.value = gfixpercent2;
  else fixpercent2.value = '';
  gbar2 = System.Gadget.Settings.read("bar2");
  if (gbar2 != '')bar2.value = gbar2;
  else bar2.value = 'FFF62A';
  gfixbar2 = System.Gadget.Settings.read("fixbar2");
  if (gfixbar2 != '')fixbar2.value = gfixbar2;
  else fixbar2.value = '';
  gread2 = System.Gadget.Settings.read("read2");
  if (gread2 != '')read2.value = gread2;
  else read2.value = '64C566';
  gfixread2 = System.Gadget.Settings.read("fixread2");
  if (gfixread2 != '')fixread2.value = gfixread2;
  else fixread2.value = '';
  gwrite2 = System.Gadget.Settings.read("write2");
  if (gwrite2 != '')write2.value = gwrite2;
  else write2.value = 'FABA00';
  gfixwrite2 = System.Gadget.Settings.read("fixwrite2");
  if (gfixwrite2 != '')fixwrite2.value = gfixwrite2;
  else fixwrite2.value = '';
  gtext3 = System.Gadget.Settings.read("text3");
  if (gtext3 != '')text3.value = gtext3;
  else text3.value = '87CEFA';
  gfixtext3 = System.Gadget.Settings.read("fixtext3");
  if (gfixtext3 != '')fixtext3.value = gfixtext3;
  else fixtext3.value = '';
  gpercent3 = System.Gadget.Settings.read("percent3");
  if (gpercent3 != '')percent3.value = gpercent3;
  else percent3.value = 'D7007A';
  gfixpercent3 = System.Gadget.Settings.read("fixpercent3");
  if (gfixpercent3 != '')fixpercent3.value = gfixpercent3;
  else fixpercent3.value = '';
  gbar3 = System.Gadget.Settings.read("bar3");
  if (gbar3 != '')bar3.value = gbar3;
  else bar3.value = 'FFF62A';
  gfixbar3 = System.Gadget.Settings.read("fixbar3");
  if (gfixbar3 != '')fixbar3.value = gfixbar3;
  else fixbar3.value = '';
  gread3 = System.Gadget.Settings.read("read3");
  if (gread3 != '')read3.value = gread3;
  else read3.value = '64C566';
  gfixread3 = System.Gadget.Settings.read("fixread3");
  if (gfixread3 != '')fixread3.value = gfixread3;
  else fixread3.value = '';
  gwrite3 = System.Gadget.Settings.read("write3");
  if (gwrite3 != '')write3.value = gwrite3;
  else write3.value = 'EC7527';
  gfixwrite3 = System.Gadget.Settings.read("fixwrite3");
  if (gfixwrite3 != '')fixwrite3.value = gfixwrite3;
  else fixwrite3.value = '';
  gtext4 = System.Gadget.Settings.read("text4");
  if (gtext4 != '')text4.value = gtext4;
  else text4.value = '87CEFA';
  gfixtext4 = System.Gadget.Settings.read("fixtext4");
  if (gfixtext4 != '')fixtext4.value = gfixtext4;
  else fixtext4.value = '';
  gpercent4 = System.Gadget.Settings.read("percent4");
  if (gpercent4 != '')percent4.value = gpercent4;
  else percent4.value = 'AE3288';
  gfixpercent4 = System.Gadget.Settings.read("fixpercent4");
  if (gfixpercent4 != '')fixpercent4.value = gfixpercent4;
  else fixpercent4.value = '';
  gbar4 = System.Gadget.Settings.read("bar4");
  if (gbar4 != '')bar4.value = gbar4;
  else bar4.value = 'FFF62A';
  gfixbar4 = System.Gadget.Settings.read("fixbar4");
  if (gfixbar4 != '')fixbar4.value = gfixbar4;
  else fixbar4.value = '';
  gread4 = System.Gadget.Settings.read("read4");
  if (gread4 != '')read4.value = gread4;
  else read4.value = '4DB896';
  gfixread4 = System.Gadget.Settings.read("fixread4");
  if (gfixread4 != '')fixread4.value = gfixread4;
  else fixread4.value = '';
  gwrite4 = System.Gadget.Settings.read("write4");
  if (gwrite4 != '')write4.value = gwrite4;
  else write4.value = '9C640A';
  gfixwrite4 = System.Gadget.Settings.read("fixwrite4");
  if (gfixwrite4 != '')fixwrite4.value = gfixwrite4;
  else fixwrite4.value = '';
  gtext5 = System.Gadget.Settings.read("text5");
  if (gtext5 != '')text5.value = gtext5;
  else text5.value = '87CEFA';
  gfixtext5 = System.Gadget.Settings.read("fixtext5");
  if (gfixtext5 != '')fixtext5.value = gfixtext5;
  else fixtext5.value = '';
  gpercent5 = System.Gadget.Settings.read("percent5");
  if (gpercent5 != '')percent5.value = gpercent5;
  else percent5.value = 'E5316C';
  gfixpercent5 = System.Gadget.Settings.read("fixpercent5");
  if (gfixpercent5 != '')fixpercent5.value = gfixpercent5;
  else fixpercent5.value = '';
  gbar5 = System.Gadget.Settings.read("bar5");
  if (gbar5 != '')bar5.value = gbar5;
  else bar5.value = 'FFF62A';
  gfixbar5 = System.Gadget.Settings.read("fixbar5");
  if (gfixbar5 != '')fixbar5.value = gfixbar5;
  else fixbar5.value = '';
  gread5 = System.Gadget.Settings.read("read5");
  if (gread5 != '')read5.value = gread5;
  else read5.value = '90EE90';
  gfixread5 = System.Gadget.Settings.read("fixread5");
  if (gfixread5 != '')fixread5.value = gfixread5;
  else fixread5.value = '';
  gwrite5 = System.Gadget.Settings.read("write5");
  if (gwrite5 != '')write5.value = gwrite5;
  else write5.value = 'FFF62A';
  gfixwrite5 = System.Gadget.Settings.read("fixwrite5");
  if (gfixwrite5 != '')fixwrite5.value = gfixwrite5;
  else fixwrite5.value = '';
  gtext6 = System.Gadget.Settings.read("text6");
  if (gtext6 != '')text6.value = gtext6;
  else text6.value = '87CEFA';
  gfixtext6 = System.Gadget.Settings.read("fixtext6");
  if (gfixtext6 != '')fixtext6.value = gfixtext6;
  else fixtext6.value = '';
  gpercent6 = System.Gadget.Settings.read("percent6");
  if (gpercent6 != '')percent6.value = gpercent6;
  else percent6.value = 'E2003B';
  gfixpercent6 = System.Gadget.Settings.read("fixpercent6");
  if (gfixpercent6 != '')fixpercent6.value = gfixpercent6;
  else fixpercent6.value = '';
  gbar6 = System.Gadget.Settings.read("bar6");
  if (gbar6 != '')bar6.value = gbar6;
  else bar6.value = 'FFF62A';
  gfixbar6 = System.Gadget.Settings.read("fixbar6");
  if (gfixbar6 != '')fixbar6.value = gfixbar6;
  else fixbar6.value = '';
  gread6 = System.Gadget.Settings.read("read6");
  if (gread6 != '')read6.value = gread6;
  else read6.value = '79B63E';
  gfixread6 = System.Gadget.Settings.read("fixread6");
  if (gfixread6 != '')fixread6.value = gfixread6;
  else fixread6.value = '';
  gwrite6 = System.Gadget.Settings.read("write6");
  if (gwrite6 != '')write6.value = gwrite6;
  else write6.value = 'FABA00';
  gfixwrite6 = System.Gadget.Settings.read("fixwrite6");
  if (gfixwrite6 != '')fixwrite6.value = gfixwrite6;
  else fixwrite6.value = '';
  gtext7 = System.Gadget.Settings.read("text7");
  if (gtext7 != '')text7.value = gtext7;
  else text7.value = '87CEFA';
  gfixtext7 = System.Gadget.Settings.read("fixtext7");
  if (gfixtext7 != '')fixtext7.value = gfixtext7;
  else fixtext7.value = '';
  gpercent7 = System.Gadget.Settings.read("percent7");
  if (gpercent7 != '')percent7.value = gpercent7;
  else percent7.value = 'D7007A';
  gfixpercent7 = System.Gadget.Settings.read("fixpercent7");
  if (gfixpercent7 != '')fixpercent7.value = gfixpercent7;
  else fixpercent7.value = '';
  gbar7 = System.Gadget.Settings.read("bar7");
  if (gbar7 != '')bar7.value = gbar7;
  else bar7.value = 'FFF62A';
  gfixbar7 = System.Gadget.Settings.read("fixbar7");
  if (gfixbar7 != '')fixbar7.value = gfixbar7;
  else fixbar7.value = '';
  gread7 = System.Gadget.Settings.read("read7");
  if (gread7 != '')read7.value = gread7;
  else read7.value = '64C566';
  gfixread7 = System.Gadget.Settings.read("fixread7");
  if (gfixread7 != '')fixread7.value = gfixread7;
  else fixread7.value = '';
  gwrite7 = System.Gadget.Settings.read("write7");
  if (gwrite7 != '')write7.value = gwrite7;
  else write7.value = 'EC7527';
  gfixwrite7 = System.Gadget.Settings.read("fixwrite7");
  if (gfixwrite7 != '')fixwrite7.value = gfixwrite7;
  else fixwrite7.value = '';
  gtext8 = System.Gadget.Settings.read("text8");
  if (gtext8 != '')text8.value = gtext8;
  else text8.value = '87CEFA';
  gfixtext8 = System.Gadget.Settings.read("fixtext8");
  if (gfixtext8 != '')fixtext8.value = gfixtext8;
  else fixtext8.value = '';
  gpercent8 = System.Gadget.Settings.read("percent8");
  if (gpercent8 != '')percent8.value = gpercent8;
  else percent8.value = 'AE3288';
  gfixpercent8 = System.Gadget.Settings.read("fixpercent8");
  if (gfixpercent8 != '')fixpercent8.value = gfixpercent8;
  else fixpercent8.value = '';
  gbar8 = System.Gadget.Settings.read("bar8");
  if (gbar8 != '')bar8.value = gbar8;
  else bar8.value = 'FFF62A';
  gfixbar8 = System.Gadget.Settings.read("fixbar8");
  if (gfixbar8 != '')fixbar8.value = gfixbar8;
  else fixbar8.value = '';
  gread8 = System.Gadget.Settings.read("read8");
  if (gread8 != '')read8.value = gread8;
  else read8.value = '4DB896';
  gfixread8 = System.Gadget.Settings.read("fixread8");
  if (gfixread8 != '')fixread8.value = gfixread8;
  else fixread8.value = '';
  gwrite8 = System.Gadget.Settings.read("write8");
  if (gwrite8 != '')write8.value = gwrite8;
  else write8.value = '9C640A';
  gfixwrite8 = System.Gadget.Settings.read("fixwrite8");
  if (gfixwrite8 != '')fixwrite8.value = gfixwrite8;
  else fixwrite8.value = '';
  gAlertIcon = System.Gadget.Settings.read("AlertIcon");
  if (gAlertIcon != '')AlertIcon.value = gAlertIcon;
  else AlertIcon.value = '90EE90';
  gfixAlertIcon = System.Gadget.Settings.read("fixAlertIcon");
  if (gfixAlertIcon != '')fixAlertIcon.value = gfixAlertIcon;
  else fixAlertIcon.value = '';
  galertDrive = System.Gadget.Settings.read("alertDrive");
  if (galertDrive != '')alertDrive.value = galertDrive;
  else alertDrive.value = '2';
  galertLowDisk1 = System.Gadget.Settings.read("alertLowDisk1");
  if (galertLowDisk1 != '')alertLowDisk1.value = galertLowDisk1;
  else alertLowDisk1.value = '1';
  galertLowDiskBelow1 = System.Gadget.Settings.read("alertLowDiskBelow1");
  if (galertLowDiskBelow1 != '')alertLowDiskBelow1.value = galertLowDiskBelow1;
  else alertLowDiskBelow1.value = '1';
  galertLowDiskByt1 = System.Gadget.Settings.read("alertLowDiskByt1");
  if (galertLowDiskByt1 != '')alertLowDiskByt1.value = galertLowDiskByt1;
  else alertLowDiskByt1.value = '2';
  gsoundLowDisk1 = System.Gadget.Settings.read("soundLowDisk1");
  if (gsoundLowDisk1 != '')soundLowDisk1.value = gsoundLowDisk1;
  else soundLowDisk1.value = '1';
  gsoundLowDiskurl1 = System.Gadget.Settings.read("soundLowDiskurl1");
  if (gsoundLowDiskurl1 != '')soundLowDiskurl1.innerText = gsoundLowDiskurl1;
  else soundLowDiskurl1.innerText = '';
  gsoundLowDiskVol1 = System.Gadget.Settings.read("soundLowDiskVol1");
  if (gsoundLowDiskVol1 != '')soundLowDiskVol1.value = gsoundLowDiskVol1;
  else soundLowDiskVol1.value = '100';
  gsoundLowDiskRepeats1 = System.Gadget.Settings.read("soundLowDiskRepeats1");
  if (gsoundLowDiskRepeats1 != '')soundLowDiskRepeats1.value = gsoundLowDiskRepeats1;
  else soundLowDiskRepeats1.value = '3';
  gsoundLowDiskCount1 = System.Gadget.Settings.read("soundLowDiskCount1");
  if (gsoundLowDiskCount1 != '')soundLowDiskCount1.value = gsoundLowDiskCount1;
  else soundLowDiskCount1.value = '1';
  galertLowDisk2 = System.Gadget.Settings.read("alertLowDisk2");
  if (galertLowDisk2 != '')alertLowDisk2.value = galertLowDisk2;
  else alertLowDisk2.value = '1';
  galertLowDiskBelow2 = System.Gadget.Settings.read("alertLowDiskBelow2");
  if (galertLowDiskBelow2 != '')alertLowDiskBelow2.value = galertLowDiskBelow2;
  else alertLowDiskBelow2.value = '1';
  galertLowDiskByt2 = System.Gadget.Settings.read("alertLowDiskByt2");
  if (galertLowDiskByt2 != '')alertLowDiskByt2.value = galertLowDiskByt2;
  else alertLowDiskByt2.value = '2';
  gsoundLowDisk2 = System.Gadget.Settings.read("soundLowDisk2");
  if (gsoundLowDisk2 != '')soundLowDisk2.value = gsoundLowDisk2;
  else soundLowDisk2.value = '1';
  gsoundLowDiskurl2 = System.Gadget.Settings.read("soundLowDiskurl2");
  if (gsoundLowDiskurl2 != '')soundLowDiskurl2.innerText = gsoundLowDiskurl2;
  else soundLowDiskurl2.innerText = '';
  gsoundLowDiskVol2 = System.Gadget.Settings.read("soundLowDiskVol2");
  if (gsoundLowDiskVol2 != '')soundLowDiskVol2.value = gsoundLowDiskVol2;
  else soundLowDiskVol2.value = '100';
  gsoundLowDiskRepeats2 = System.Gadget.Settings.read("soundLowDiskRepeats2");
  if (gsoundLowDiskRepeats2 != '')soundLowDiskRepeats2.value = gsoundLowDiskRepeats2;
  else soundLowDiskRepeats2.value = '3';
  gsoundLowDiskCount2 = System.Gadget.Settings.read("soundLowDiskCount2");
  if (gsoundLowDiskCount2 != '')soundLowDiskCount2.value = gsoundLowDiskCount2;
  else soundLowDiskCount2.value = '1';
  galertLowDisk3 = System.Gadget.Settings.read("alertLowDisk3");
  if (galertLowDisk3 != '')alertLowDisk3.value = galertLowDisk3;
  else alertLowDisk3.value = '1';
  galertLowDiskBelow3 = System.Gadget.Settings.read("alertLowDiskBelow3");
  if (galertLowDiskBelow3 != '')alertLowDiskBelow3.value = galertLowDiskBelow3;
  else alertLowDiskBelow3.value = '1';
  galertLowDiskByt3 = System.Gadget.Settings.read("alertLowDiskByt3");
  if (galertLowDiskByt3 != '')alertLowDiskByt3.value = galertLowDiskByt3;
  else alertLowDiskByt3.value = '2';
  gsoundLowDisk3 = System.Gadget.Settings.read("soundLowDisk3");
  if (gsoundLowDisk3 != '')soundLowDisk3.value = gsoundLowDisk3;
  else soundLowDisk3.value = '1';
  gsoundLowDiskurl3 = System.Gadget.Settings.read("soundLowDiskurl3");
  if (gsoundLowDiskurl3 != '')soundLowDiskurl3.innerText = gsoundLowDiskurl3;
  else soundLowDiskurl3.innerText = '';
  gsoundLowDiskVol3 = System.Gadget.Settings.read("soundLowDiskVol3");
  if (gsoundLowDiskVol3 != '')soundLowDiskVol3.value = gsoundLowDiskVol3;
  else soundLowDiskVol3.value = '100';
  gsoundLowDiskRepeats3 = System.Gadget.Settings.read("soundLowDiskRepeats3");
  if (gsoundLowDiskRepeats3 != '')soundLowDiskRepeats3.value = gsoundLowDiskRepeats3;
  else soundLowDiskRepeats3.value = '3';
  gsoundLowDiskCount3 = System.Gadget.Settings.read("soundLowDiskCount3");
  if (gsoundLowDiskCount3 != '')soundLowDiskCount3.value = gsoundLowDiskCount3;
  else soundLowDiskCount3.value = '1';
  galertLowDisk4 = System.Gadget.Settings.read("alertLowDisk4");
  if (galertLowDisk4 != '')alertLowDisk4.value = galertLowDisk4;
  else alertLowDisk4.value = '1';
  galertLowDiskBelow4 = System.Gadget.Settings.read("alertLowDiskBelow4");
  if (galertLowDiskBelow4 != '')alertLowDiskBelow4.value = galertLowDiskBelow4;
  else alertLowDiskBelow4.value = '1';
  galertLowDiskByt4 = System.Gadget.Settings.read("alertLowDiskByt4");
  if (galertLowDiskByt4 != '')alertLowDiskByt4.value = galertLowDiskByt4;
  else alertLowDiskByt4.value = '2';
  gsoundLowDisk4 = System.Gadget.Settings.read("soundLowDisk4");
  if (gsoundLowDisk4 != '')soundLowDisk4.value = gsoundLowDisk4;
  else soundLowDisk4.value = '1';
  gsoundLowDiskurl4 = System.Gadget.Settings.read("soundLowDiskurl4");
  if (gsoundLowDiskurl4 != '')soundLowDiskurl4.innerText = gsoundLowDiskurl4;
  else soundLowDiskurl4.innerText = '';
  gsoundLowDiskVol4 = System.Gadget.Settings.read("soundLowDiskVol4");
  if (gsoundLowDiskVol4 != '')soundLowDiskVol4.value = gsoundLowDiskVol4;
  else soundLowDiskVol4.value = '100';
  gsoundLowDiskRepeats4 = System.Gadget.Settings.read("soundLowDiskRepeats4");
  if (gsoundLowDiskRepeats4 != '')soundLowDiskRepeats4.value = gsoundLowDiskRepeats4;
  else soundLowDiskRepeats4.value = '3';
  gsoundLowDiskCount4 = System.Gadget.Settings.read("soundLowDiskCount4");
  if (gsoundLowDiskCount4 != '')soundLowDiskCount4.value = gsoundLowDiskCount4;
  else soundLowDiskCount4.value = '1';
  galertLowDisk5 = System.Gadget.Settings.read("alertLowDisk5");
  if (galertLowDisk5 != '')alertLowDisk5.value = galertLowDisk5;
  else alertLowDisk5.value = '1';
  galertLowDiskBelow5 = System.Gadget.Settings.read("alertLowDiskBelow5");
  if (galertLowDiskBelow5 != '')alertLowDiskBelow5.value = galertLowDiskBelow5;
  else alertLowDiskBelow5.value = '1';
  galertLowDiskByt5 = System.Gadget.Settings.read("alertLowDiskByt5");
  if (galertLowDiskByt5 != '')alertLowDiskByt5.value = galertLowDiskByt5;
  else alertLowDiskByt5.value = '2';
  gsoundLowDisk5 = System.Gadget.Settings.read("soundLowDisk5");
  if (gsoundLowDisk5 != '')soundLowDisk5.value = gsoundLowDisk5;
  else soundLowDisk5.value = '1';
  gsoundLowDiskurl5 = System.Gadget.Settings.read("soundLowDiskurl5");
  if (gsoundLowDiskurl5 != '')soundLowDiskurl5.innerText = gsoundLowDiskurl5;
  else soundLowDiskurl5.innerText = '';
  gsoundLowDiskVol5 = System.Gadget.Settings.read("soundLowDiskVol5");
  if (gsoundLowDiskVol5 != '')soundLowDiskVol5.value = gsoundLowDiskVol5;
  else soundLowDiskVol5.value = '100';
  gsoundLowDiskRepeats5 = System.Gadget.Settings.read("soundLowDiskRepeats5");
  if (gsoundLowDiskRepeats5 != '')soundLowDiskRepeats5.value = gsoundLowDiskRepeats5;
  else soundLowDiskRepeats5.value = '3';
  gsoundLowDiskCount5 = System.Gadget.Settings.read("soundLowDiskCount5");
  if (gsoundLowDiskCount5 != '')soundLowDiskCount5.value = gsoundLowDiskCount5;
  else soundLowDiskCount5.value = '1';
  galertLowDisk6 = System.Gadget.Settings.read("alertLowDisk6");
  if (galertLowDisk6 != '')alertLowDisk6.value = galertLowDisk6;
  else alertLowDisk6.value = '1';
  galertLowDiskBelow6 = System.Gadget.Settings.read("alertLowDiskBelow6");
  if (galertLowDiskBelow6 != '')alertLowDiskBelow6.value = galertLowDiskBelow6;
  else alertLowDiskBelow6.value = '1';
  galertLowDiskByt6 = System.Gadget.Settings.read("alertLowDiskByt6");
  if (galertLowDiskByt6 != '')alertLowDiskByt6.value = galertLowDiskByt6;
  else alertLowDiskByt6.value = '2';
  gsoundLowDisk6 = System.Gadget.Settings.read("soundLowDisk6");
  if (gsoundLowDisk6 != '')soundLowDisk6.value = gsoundLowDisk6;
  else soundLowDisk6.value = '1';
  gsoundLowDiskurl6 = System.Gadget.Settings.read("soundLowDiskurl6");
  if (gsoundLowDiskurl6 != '')soundLowDiskurl6.innerText = gsoundLowDiskurl6;
  else soundLowDiskurl6.innerText = '';
  gsoundLowDiskVol6 = System.Gadget.Settings.read("soundLowDiskVol6");
  if (gsoundLowDiskVol6 != '')soundLowDiskVol6.value = gsoundLowDiskVol6;
  else soundLowDiskVol6.value = '100';
  gsoundLowDiskRepeats6 = System.Gadget.Settings.read("soundLowDiskRepeats6");
  if (gsoundLowDiskRepeats6 != '')soundLowDiskRepeats6.value = gsoundLowDiskRepeats6;
  else soundLowDiskRepeats6.value = '3';
  gsoundLowDiskCount6 = System.Gadget.Settings.read("soundLowDiskCount6");
  if (gsoundLowDiskCount6 != '')soundLowDiskCount6.value = gsoundLowDiskCount6;
  else soundLowDiskCount6.value = '1';
  galertLowDisk7 = System.Gadget.Settings.read("alertLowDisk7");
  if (galertLowDisk7 != '')alertLowDisk7.value = galertLowDisk7;
  else alertLowDisk7.value = '1';
  galertLowDiskBelow7 = System.Gadget.Settings.read("alertLowDiskBelow7");
  if (galertLowDiskBelow7 != '')alertLowDiskBelow7.value = galertLowDiskBelow7;
  else alertLowDiskBelow7.value = '1';
  galertLowDiskByt7 = System.Gadget.Settings.read("alertLowDiskByt7");
  if (galertLowDiskByt7 != '')alertLowDiskByt7.value = galertLowDiskByt7;
  else alertLowDiskByt7.value = '2';
  gsoundLowDisk7 = System.Gadget.Settings.read("soundLowDisk7");
  if (gsoundLowDisk7 != '')soundLowDisk7.value = gsoundLowDisk7;
  else soundLowDisk7.value = '1';
  gsoundLowDiskurl7 = System.Gadget.Settings.read("soundLowDiskurl7");
  if (gsoundLowDiskurl7 != '')soundLowDiskurl7.innerText = gsoundLowDiskurl7;
  else soundLowDiskurl7.innerText = '';
  gsoundLowDiskVol7 = System.Gadget.Settings.read("soundLowDiskVol7");
  if (gsoundLowDiskVol7 != '')soundLowDiskVol7.value = gsoundLowDiskVol7;
  else soundLowDiskVol7.value = '100';
  gsoundLowDiskRepeats7 = System.Gadget.Settings.read("soundLowDiskRepeats7");
  if (gsoundLowDiskRepeats7 != '')soundLowDiskRepeats7.value = gsoundLowDiskRepeats7;
  else soundLowDiskRepeats7.value = '3';
  gsoundLowDiskCount7 = System.Gadget.Settings.read("soundLowDiskCount7");
  if (gsoundLowDiskCount7 != '')soundLowDiskCount7.value = gsoundLowDiskCount7;
  else soundLowDiskCount7.value = '1';
  galertLowDisk8 = System.Gadget.Settings.read("alertLowDisk8");
  if (galertLowDisk8 != '')alertLowDisk8.value = galertLowDisk8;
  else alertLowDisk8.value = '1';
  galertLowDiskBelow8 = System.Gadget.Settings.read("alertLowDiskBelow8");
  if (galertLowDiskBelow8 != '')alertLowDiskBelow8.value = galertLowDiskBelow8;
  else alertLowDiskBelow8.value = '1';
  galertLowDiskByt8 = System.Gadget.Settings.read("alertLowDiskByt8");
  if (galertLowDiskByt8 != '')alertLowDiskByt8.value = galertLowDiskByt8;
  else alertLowDiskByt8.value = '2';
  gsoundLowDisk8 = System.Gadget.Settings.read("soundLowDisk8");
  if (gsoundLowDisk8 != '')soundLowDisk8.value = gsoundLowDisk8;
  else soundLowDisk8.value = '1';
  gsoundLowDiskurl8 = System.Gadget.Settings.read("soundLowDiskurl8");
  if (gsoundLowDiskurl8 != '')soundLowDiskurl8.innerText = gsoundLowDiskurl8;
  else soundLowDiskurl8.innerText = '';
  gsoundLowDiskVol8 = System.Gadget.Settings.read("soundLowDiskVol8");
  if (gsoundLowDiskVol8 != '')soundLowDiskVol8.value = gsoundLowDiskVol8;
  else soundLowDiskVol8.value = '100';
  gsoundLowDiskRepeats8 = System.Gadget.Settings.read("soundLowDiskRepeats8");
  if (gsoundLowDiskRepeats8 != '')soundLowDiskRepeats8.value = gsoundLowDiskRepeats8;
  else soundLowDiskRepeats8.value = '3';
  gsoundLowDiskCount8 = System.Gadget.Settings.read("soundLowDiskCount8");
  if (gsoundLowDiskCount8 != '')soundLowDiskCount8.value = gsoundLowDiskCount8;
  else soundLowDiskCount8.value = '1';
  gallDiskActivity = System.Gadget.Settings.read("allDiskActivity");
  if (gallDiskActivity != '')allDiskActivity.value = gallDiskActivity;
  else allDiskActivity.value = '1';
  gFlyoutBac = System.Gadget.Settings.read("FlyoutBac");
  if (gFlyoutBac != '')FlyoutBac.value = gFlyoutBac;
  else FlyoutBac.value = '080808';
  gfixFlyoutBac = System.Gadget.Settings.read("fixFlyoutBac");
  if (gfixFlyoutBac != '')fixFlyoutBac.value = gfixFlyoutBac;
  else fixFlyoutBac.value = '';
  gFlyoutTit = System.Gadget.Settings.read("FlyoutTit");
  if (gFlyoutTit != '')FlyoutTit.value = gFlyoutTit;
  else FlyoutTit.value = '87cefa';
  gfixFlyoutTit = System.Gadget.Settings.read("fixFlyoutTit");
  if (gfixFlyoutTit != '')fixFlyoutTit.value = gfixFlyoutTit;
  else fixFlyoutTit.value = '';
  gFlyoutDet = System.Gadget.Settings.read("FlyoutDet");
  if (gFlyoutDet != '')FlyoutDet.value = gFlyoutDet;
  else FlyoutDet.value = 'ffcc00';
  gfixFlyoutDet = System.Gadget.Settings.read("fixFlyoutDet");
  if (gfixFlyoutDet != '')fixFlyoutDet.value = gfixFlyoutDet;
  else fixFlyoutDet.value = '';
}
function savefilesettings(){
  var fs = new ActiveXObject("Scripting.FileSystemObject");
  var inifilename = System.Environment.getEnvironmentVariable("APPDATA") + "\\" + System.
  Gadget.name + "_Settings.ini";
  try {
    var inifile = fs.OpenTextFile(inifilename, 2, true);
    try {
      inifile.WriteLine(";Drives Meter (c) 2007-2012 AddGadgets.com");
      inifile.WriteLine(";v2");
      inifile.WriteLine(fixsize.value);
      inifile.WriteLine(ssize.value);
      inifile.WriteLine(settimer.value);
      inifile.WriteLine(drawstyle.value);
      inifile.WriteLine(ScaleType.value);
      inifile.WriteLine(ScaleSize.value);
      inifile.WriteLine(fixUnit.value);
      inifile.WriteLine(update.value);
      inifile.WriteLine("#" + backg.value);
      inifile.WriteLine(fixBackg.value);
      inifile.WriteLine("#" + title.value);
      inifile.WriteLine(fixTitle.value);
      inifile.WriteLine(graph.value);
      if (fixsize.value == "Custom"){
        inifile.WriteLine(ssize.value / 100)
      }
      else {
        inifile.WriteLine(fixsize.value / 100)
      }
      inifile.WriteLine("#" + AlertIcon.value);
      inifile.WriteLine(fixAlertIcon.value);
      inifile.WriteLine(alertDrive.value);
      inifile.WriteLine(showDrive2.value);
      inifile.WriteLine(showDrive3.value);
      inifile.WriteLine(showDrive4.value);
      inifile.WriteLine(showDrive5.value);
      inifile.WriteLine(showDrive6.value);
      inifile.WriteLine(showDrive7.value);
      inifile.WriteLine(showDrive8.value);
      inifile.WriteLine(drive1.value);
      inifile.WriteLine(alertLowDisk1.value);
      inifile.WriteLine(alertLowDiskBelow1.value);
      inifile.WriteLine(alertLowDiskByt1.value);
      inifile.WriteLine(soundLowDisk1.value);
      inifile.WriteLine(soundLowDiskurl1.innerText);
      inifile.WriteLine(soundLowDiskVol1.value);
      inifile.WriteLine(soundLowDiskRepeats1.value);
      inifile.WriteLine(soundLowDiskCount1.value);
      inifile.WriteLine("#" + text1.value);
      inifile.WriteLine(fixtext1.value);
      inifile.WriteLine("#" + percent1.value);
      inifile.WriteLine(fixpercent1.value);
      inifile.WriteLine("#" + bar1.value);
      inifile.WriteLine(fixbar1.value);
      inifile.WriteLine("#" + read1.value);
      inifile.WriteLine(fixread1.value);
      inifile.WriteLine("#" + write1.value);
      inifile.WriteLine(fixwrite1.value);
      inifile.WriteLine(drive2.value);
      inifile.WriteLine(alertLowDisk2.value);
      inifile.WriteLine(alertLowDiskBelow2.value);
      inifile.WriteLine(alertLowDiskByt2.value);
      inifile.WriteLine(soundLowDisk2.value);
      inifile.WriteLine(soundLowDiskurl2.innerText);
      inifile.WriteLine(soundLowDiskVol2.value);
      inifile.WriteLine(soundLowDiskRepeats2.value);
      inifile.WriteLine(soundLowDiskCount2.value);
      inifile.WriteLine("#" + text2.value);
      inifile.WriteLine(fixtext2.value);
      inifile.WriteLine("#" + percent2.value);
      inifile.WriteLine(fixpercent2.value);
      inifile.WriteLine("#" + bar2.value);
      inifile.WriteLine(fixbar2.value);
      inifile.WriteLine("#" + read2.value);
      inifile.WriteLine(fixread2.value);
      inifile.WriteLine("#" + write2.value);
      inifile.WriteLine(fixwrite2.value);
      inifile.WriteLine(drive3.value);
      inifile.WriteLine(alertLowDisk3.value);
      inifile.WriteLine(alertLowDiskBelow3.value);
      inifile.WriteLine(alertLowDiskByt3.value);
      inifile.WriteLine(soundLowDisk3.value);
      inifile.WriteLine(soundLowDiskurl3.innerText);
      inifile.WriteLine(soundLowDiskVol3.value);
      inifile.WriteLine(soundLowDiskRepeats3.value);
      inifile.WriteLine(soundLowDiskCount3.value);
      inifile.WriteLine("#" + text3.value);
      inifile.WriteLine(fixtext3.value);
      inifile.WriteLine("#" + percent3.value);
      inifile.WriteLine(fixpercent3.value);
      inifile.WriteLine("#" + bar3.value);
      inifile.WriteLine(fixbar3.value);
      inifile.WriteLine("#" + read3.value);
      inifile.WriteLine(fixread3.value);
      inifile.WriteLine("#" + write3.value);
      inifile.WriteLine(fixwrite3.value);
      inifile.WriteLine(drive4.value);
      inifile.WriteLine(alertLowDisk4.value);
      inifile.WriteLine(alertLowDiskBelow4.value);
      inifile.WriteLine(alertLowDiskByt4.value);
      inifile.WriteLine(soundLowDisk4.value);
      inifile.WriteLine(soundLowDiskurl4.innerText);
      inifile.WriteLine(soundLowDiskVol4.value);
      inifile.WriteLine(soundLowDiskRepeats4.value);
      inifile.WriteLine(soundLowDiskCount4.value);
      inifile.WriteLine("#" + text4.value);
      inifile.WriteLine(fixtext4.value);
      inifile.WriteLine("#" + percent4.value);
      inifile.WriteLine(fixpercent4.value);
      inifile.WriteLine("#" + bar4.value);
      inifile.WriteLine(fixbar4.value);
      inifile.WriteLine("#" + read4.value);
      inifile.WriteLine(fixread4.value);
      inifile.WriteLine("#" + write4.value);
      inifile.WriteLine(fixwrite4.value);
      inifile.WriteLine(drive5.value);
      inifile.WriteLine(alertLowDisk5.value);
      inifile.WriteLine(alertLowDiskBelow5.value);
      inifile.WriteLine(alertLowDiskByt5.value);
      inifile.WriteLine(soundLowDisk5.value);
      inifile.WriteLine(soundLowDiskurl5.innerText);
      inifile.WriteLine(soundLowDiskVol5.value);
      inifile.WriteLine(soundLowDiskRepeats5.value);
      inifile.WriteLine(soundLowDiskCount5.value);
      inifile.WriteLine("#" + text5.value);
      inifile.WriteLine(fixtext5.value);
      inifile.WriteLine("#" + percent5.value);
      inifile.WriteLine(fixpercent5.value);
      inifile.WriteLine("#" + bar5.value);
      inifile.WriteLine(fixbar5.value);
      inifile.WriteLine("#" + read5.value);
      inifile.WriteLine(fixread5.value);
      inifile.WriteLine("#" + write5.value);
      inifile.WriteLine(fixwrite5.value);
      inifile.WriteLine(drive6.value);
      inifile.WriteLine(alertLowDisk6.value);
      inifile.WriteLine(alertLowDiskBelow6.value);
      inifile.WriteLine(alertLowDiskByt6.value);
      inifile.WriteLine(soundLowDisk6.value);
      inifile.WriteLine(soundLowDiskurl6.innerText);
      inifile.WriteLine(soundLowDiskVol6.value);
      inifile.WriteLine(soundLowDiskRepeats6.value);
      inifile.WriteLine(soundLowDiskCount6.value);
      inifile.WriteLine("#" + text6.value);
      inifile.WriteLine(fixtext6.value);
      inifile.WriteLine("#" + percent6.value);
      inifile.WriteLine(fixpercent6.value);
      inifile.WriteLine("#" + bar6.value);
      inifile.WriteLine(fixbar6.value);
      inifile.WriteLine("#" + read6.value);
      inifile.WriteLine(fixread6.value);
      inifile.WriteLine("#" + write6.value);
      inifile.WriteLine(fixwrite6.value);
      inifile.WriteLine(drive7.value);
      inifile.WriteLine(alertLowDisk7.value);
      inifile.WriteLine(alertLowDiskBelow7.value);
      inifile.WriteLine(alertLowDiskByt7.value);
      inifile.WriteLine(soundLowDisk7.value);
      inifile.WriteLine(soundLowDiskurl7.innerText);
      inifile.WriteLine(soundLowDiskVol7.value);
      inifile.WriteLine(soundLowDiskRepeats7.value);
      inifile.WriteLine(soundLowDiskCount7.value);
      inifile.WriteLine("#" + text7.value);
      inifile.WriteLine(fixtext7.value);
      inifile.WriteLine("#" + percent7.value);
      inifile.WriteLine(fixpercent7.value);
      inifile.WriteLine("#" + bar7.value);
      inifile.WriteLine(fixbar7.value);
      inifile.WriteLine("#" + read7.value);
      inifile.WriteLine(fixread7.value);
      inifile.WriteLine("#" + write7.value);
      inifile.WriteLine(fixwrite7.value);
      inifile.WriteLine(drive8.value);
      inifile.WriteLine(alertLowDisk8.value);
      inifile.WriteLine(alertLowDiskBelow8.value);
      inifile.WriteLine(alertLowDiskByt8.value);
      inifile.WriteLine(soundLowDisk8.value);
      inifile.WriteLine(soundLowDiskurl8.innerText);
      inifile.WriteLine(soundLowDiskVol8.value);
      inifile.WriteLine(soundLowDiskRepeats8.value);
      inifile.WriteLine(soundLowDiskCount8.value);
      inifile.WriteLine("#" + text8.value);
      inifile.WriteLine(fixtext8.value);
      inifile.WriteLine("#" + percent8.value);
      inifile.WriteLine(fixpercent8.value);
      inifile.WriteLine("#" + bar8.value);
      inifile.WriteLine(fixbar8.value);
      inifile.WriteLine("#" + read8.value);
      inifile.WriteLine(fixread8.value);
      inifile.WriteLine("#" + write8.value);
      inifile.WriteLine(fixwrite8.value);
      inifile.WriteLine(allDiskActivity.value);
      inifile.WriteLine("#" + FlyoutBac.value);
      inifile.WriteLine(fixFlyoutBac.value);
      inifile.WriteLine("#" + FlyoutTit.value);
      inifile.WriteLine(fixFlyoutTit.value);
      inifile.WriteLine("#" + FlyoutDet.value);
      inifile.WriteLine(fixFlyoutDet.value);
    }
    finally{
      inifile.Close();
    }
  }
  catch (err){
  }
}
function CheckAndSetDrives(){
  var a = O("drive1").value.toUpperCase();
  a = a.replace(/[^A-Za-z]+/g, "");
  if (a.length === 0){
    a = "C";
  }
  System.Gadget.Settings.write("drive1", a);
  var b = O("drive2").value.toUpperCase();
  b = b.replace(/[^A-Za-z]+/g, "");
  if (b.length === 0){
    b = "D";
  }
  System.Gadget.Settings.write("drive2", b);
  var c = O("drive3").value.toUpperCase();
  c = c.replace(/[^A-Za-z]+/g, "");
  if (c.length === 0){
    c = "E";
  }
  System.Gadget.Settings.write("drive3", c);
  var d = O("drive4").value.toUpperCase();
  d = d.replace(/[^A-Za-z]+/g, "");
  if (d.length === 0){
    d = "F";
  }
  System.Gadget.Settings.write("drive4", d);
  var e = O("drive5").value.toUpperCase();
  e = e.replace(/[^A-Za-z]+/g, "");
  if (e.length === 0){
    e = "G";
  }
  System.Gadget.Settings.write("drive5", e);
  var f = O("drive6").value.toUpperCase();
  f = f.replace(/[^A-Za-z]+/g, "");
  if (f.length === 0){
    f = "H";
  }
  System.Gadget.Settings.write("drive6", f);
  var g = O("drive7").value.toUpperCase();
  g = g.replace(/[^A-Za-z]+/g, "");
  if (g.length === 0){
    g = "I";
  }
  System.Gadget.Settings.write("drive7", g);
  var h = O("drive8").value.toUpperCase();
  h = h.replace(/[^A-Za-z]+/g, "");
  if (h.length === 0){
    h = "J";
  }
  System.Gadget.Settings.write("drive8", h);
}
function driveSettings(){
  if (showDrive2.value == 2){
    O('settingD3').style.visibility = "visible";
    if (showDrive3.value == 2){
      O('settingD4').style.visibility = "visible";
      if (showDrive4.value == 2){
        O('settingD5').style.visibility = "visible";
        if (showDrive5.value == 2){
          O('settingD6').style.visibility = "visible";
          if (showDrive6.value == 2){
            O('settingD7').style.visibility = "visible";
            if (showDrive7.value == 2){
              O('settingD8').style.visibility = "visible";
            }
            else {
              O('settingD8').style.visibility = "hidden";
              showDrive8.value = "1";
            }
          }
          else {
            O('settingD7').style.visibility = "hidden";
            O('settingD8').style.visibility = "hidden";
            showDrive7.value = "1";
            showDrive8.value = "1";
          }
        }
        else {
          O('settingD6').style.visibility = "hidden";
          O('settingD7').style.visibility = "hidden";
          O('settingD8').style.visibility = "hidden";
          showDrive6.value = "1";
          showDrive7.value = "1";
          showDrive8.value = "1";
        }
      }
      else {
        O('settingD5').style.visibility = "hidden";
        O('settingD6').style.visibility = "hidden";
        O('settingD7').style.visibility = "hidden";
        O('settingD8').style.visibility = "hidden";
        showDrive5.value = "1";
        showDrive6.value = "1";
        showDrive7.value = "1";
        showDrive8.value = "1";
      }
    }
    else {
      O('settingD4').style.visibility = "hidden";
      O('settingD5').style.visibility = "hidden";
      O('settingD6').style.visibility = "hidden";
      O('settingD7').style.visibility = "hidden";
      O('settingD8').style.visibility = "hidden";
      showDrive4.value = "1";
      showDrive5.value = "1";
      showDrive6.value = "1";
      showDrive7.value = "1";
      showDrive8.value = "1";
    }
  }
  else {
    O('settingD3').style.visibility = "hidden";
    O('settingD4').style.visibility = "hidden";
    O('settingD5').style.visibility = "hidden";
    O('settingD6').style.visibility = "hidden";
    O('settingD7').style.visibility = "hidden";
    O('settingD8').style.visibility = "hidden";
    showDrive3.value = "1";
    showDrive4.value = "1";
    showDrive5.value = "1";
    showDrive6.value = "1";
    showDrive7.value = "1";
    showDrive8.value = "1";
  }
}
function chooseSoundLowDisk(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl1.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol1.value;
    Player.URL = soundLowDiskurl1.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk(){
  if (soundLowDisk1.value == 100){
  }
  else if (soundLowDisk1.value == 50){
    Player.URL = soundLowDiskurl1.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk1.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol1.value;
  Player.Controls.play();
}
function chooseSoundLowDisk2(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl2.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol2.value;
    Player.URL = soundLowDiskurl2.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk2(){
  if (soundLowDisk2.value == 100){
  }
  else if (soundLowDisk2.value == 50){
    Player.URL = soundLowDiskurl2.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk2.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol2.value;
  Player.Controls.play();
}
function chooseSoundLowDisk3(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl3.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol3.value;
    Player.URL = soundLowDiskurl3.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk3(){
  if (soundLowDisk3.value == 100){
  }
  else if (soundLowDisk3.value == 50){
    Player.URL = soundLowDiskurl3.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk3.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol3.value;
  Player.Controls.play();
}
function chooseSoundLowDisk4(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl4.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol4.value;
    Player.URL = soundLowDiskurl4.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk4(){
  if (soundLowDisk4.value == 100){
  }
  else if (soundLowDisk4.value == 50){
    Player.URL = soundLowDiskurl4.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk4.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol4.value;
  Player.Controls.play();
}
function chooseSoundLowDisk5(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl5.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol5.value;
    Player.URL = soundLowDiskurl5.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk5(){
  if (soundLowDisk5.value == 100){
  }
  else if (soundLowDisk5.value == 50){
    Player.URL = soundLowDiskurl5.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk5.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol5.value;
  Player.Controls.play();
}
function chooseSoundLowDisk6(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl6.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol6.value;
    Player.URL = soundLowDiskurl6.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk6(){
  if (soundLowDisk6.value == 100){
  }
  else if (soundLowDisk6.value == 50){
    Player.URL = soundLowDiskurl6.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk6.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol6.value;
  Player.Controls.play();
}
function chooseSoundLowDisk7(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl7.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol7.value;
    Player.URL = soundLowDiskurl7.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk7(){
  if (soundLowDisk7.value == 100){
  }
  else if (soundLowDisk7.value == 50){
    Player.URL = soundLowDiskurl7.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk7.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol7.value;
  Player.Controls.play();
}
function chooseSoundLowDisk8(){
  var shellitem = System.Shell.chooseFile(true, 
  "Music files:*.asx;*.wpl;*.mp3;*.wav;*.wma::", "", "");
  if (shellitem != null){
    soundLowDiskurl8.innerText = shellitem.path;
    Player.settings.volume = soundLowDiskVol8.value;
    Player.URL = soundLowDiskurl8.innerText;
    Player.Controls.play();
  }
}
function playchooseLowDisk8(){
  if (soundLowDisk8.value == 100){
  }
  else if (soundLowDisk8.value == 50){
    Player.URL = soundLowDiskurl8.innerText;
  }
  else {
    Player.URL = System.Gadget.path + "\\alarm" + soundLowDisk8.value + ".mp3";
  }
  Player.settings.volume = soundLowDiskVol8.value;
  Player.Controls.play();
}
function clickstop(){
  if (Player.controls.isAvailable('Stop')){
    Player.controls.stop();
  }
}
function soundSettingsLowDisk(){
  if (soundLowDisk1.value == "50"){
    O('csLowDisk1').style.visibility = "visible";
    O('soundLowDiskurl1').style.visibility = "visible";
  }
  else {
    O('csLowDisk1').style.visibility = "hidden";
    O('soundLowDiskurl1').style.visibility = "hidden";
  }
}
function soundLowDiskRepeatsSettings(){
  if (soundLowDiskRepeats1.value == "3"){
    O('soundLowDiskCount1').style.visibility = "visible";
    O('timesLowDisk1').style.visibility = "visible";
  }
  else {
    O('soundLowDiskCount1').style.visibility = "hidden";
    O('timesLowDisk1').style.visibility = "hidden";
  }
}
function soundSettingsLowDisk2(){
  if (soundLowDisk2.value == "50"){
    O('csLowDisk2').style.visibility = "visible";
    O('soundLowDiskurl2').style.visibility = "visible";
  }
  else {
    O('csLowDisk2').style.visibility = "hidden";
    O('soundLowDiskurl2').style.visibility = "hidden";
  }
}
function soundLowDiskRepeats2Settings(){
  if (soundLowDiskRepeats2.value == "3"){
    O('soundLowDiskCount2').style.visibility = "visible";
    O('timesLowDisk2').style.visibility = "visible";
  }
  else {
    O('soundLowDiskCount2').style.visibility = "hidden";
    O('timesLowDisk2').style.visibility = "hidden";
  }
}
function soundSettingsLowDisk3(){
  if (showDrive2.value == 1){
    O('csLowDisk3').style.visibility = "hidden";
    O('soundLowDiskurl3').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk3.value == "50"){
      O('csLowDisk3').style.visibility = "visible";
      O('soundLowDiskurl3').style.visibility = "visible";
    }
    else {
      O('csLowDisk3').style.visibility = "hidden";
      O('soundLowDiskurl3').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats3Settings(){
  if (showDrive2.value == 1){
    O('soundLowDiskCount3').style.visibility = "hidden";
    O('timesLowDisk3').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats3.value == "3"){
      O('soundLowDiskCount3').style.visibility = "visible";
      O('timesLowDisk3').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount3').style.visibility = "hidden";
      O('timesLowDisk3').style.visibility = "hidden";
    }
  }
}
function soundSettingsLowDisk4(){
  if (showDrive3.value == 1){
    O('csLowDisk4').style.visibility = "hidden";
    O('soundLowDiskurl4').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk4.value == "50"){
      O('csLowDisk4').style.visibility = "visible";
      O('soundLowDiskurl4').style.visibility = "visible";
    }
    else {
      O('csLowDisk4').style.visibility = "hidden";
      O('soundLowDiskurl4').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats4Settings(){
  if (showDrive3.value == 1){
    O('soundLowDiskCount4').style.visibility = "hidden";
    O('timesLowDisk4').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats4.value == "3"){
      O('soundLowDiskCount4').style.visibility = "visible";
      O('timesLowDisk4').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount4').style.visibility = "hidden";
      O('timesLowDisk4').style.visibility = "hidden";
    }
  }
}
function soundSettingsLowDisk5(){
  if (showDrive4.value == 1){
    O('csLowDisk5').style.visibility = "hidden";
    O('soundLowDiskurl5').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk5.value == "50"){
      O('csLowDisk5').style.visibility = "visible";
      O('soundLowDiskurl5').style.visibility = "visible";
    }
    else {
      O('csLowDisk5').style.visibility = "hidden";
      O('soundLowDiskurl5').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats5Settings(){
  if (showDrive4.value == 1){
    O('soundLowDiskCount5').style.visibility = "hidden";
    O('timesLowDisk5').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats5.value == "3"){
      O('soundLowDiskCount5').style.visibility = "visible";
      O('timesLowDisk5').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount5').style.visibility = "hidden";
      O('timesLowDisk5').style.visibility = "hidden";
    }
  }
}
function soundSettingsLowDisk6(){
  if (showDrive5.value == 1){
    O('csLowDisk6').style.visibility = "hidden";
    O('soundLowDiskurl6').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk6.value == "50"){
      O('csLowDisk6').style.visibility = "visible";
      O('soundLowDiskurl6').style.visibility = "visible";
    }
    else {
      O('csLowDisk6').style.visibility = "hidden";
      O('soundLowDiskurl6').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats6Settings(){
  if (showDrive5.value == 1){
    O('soundLowDiskCount6').style.visibility = "hidden";
    O('timesLowDisk6').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats6.value == "3"){
      O('soundLowDiskCount6').style.visibility = "visible";
      O('timesLowDisk6').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount6').style.visibility = "hidden";
      O('timesLowDisk6').style.visibility = "hidden";
    }
  }
}
function soundSettingsLowDisk7(){
  if (showDrive6.value == 1){
    O('csLowDisk7').style.visibility = "hidden";
    O('soundLowDiskurl7').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk7.value == "50"){
      O('csLowDisk7').style.visibility = "visible";
      O('soundLowDiskurl7').style.visibility = "visible";
    }
    else {
      O('csLowDisk7').style.visibility = "hidden";
      O('soundLowDiskurl7').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats7Settings(){
  if (showDrive6.value == 1){
    O('soundLowDiskCount7').style.visibility = "hidden";
    O('timesLowDisk7').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats7.value == "3"){
      O('soundLowDiskCount7').style.visibility = "visible";
      O('timesLowDisk7').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount7').style.visibility = "hidden";
      O('timesLowDisk7').style.visibility = "hidden";
    }
  }
}
function soundSettingsLowDisk8(){
  if (showDrive7.value == 1){
    O('csLowDisk8').style.visibility = "hidden";
    O('soundLowDiskurl8').style.visibility = "hidden";
  }
  else {
    if (soundLowDisk8.value == "50"){
      O('csLowDisk8').style.visibility = "visible";
      O('soundLowDiskurl8').style.visibility = "visible";
    }
    else {
      O('csLowDisk8').style.visibility = "hidden";
      O('soundLowDiskurl8').style.visibility = "hidden";
    }
  }
}
function soundLowDiskRepeats8Settings(){
  if (showDrive7.value == 1){
    O('soundLowDiskCount8').style.visibility = "hidden";
    O('timesLowDisk8').style.visibility = "hidden";
  }
  else {
    if (soundLowDiskRepeats8.value == "3"){
      O('soundLowDiskCount8').style.visibility = "visible";
      O('timesLowDisk8').style.visibility = "visible";
    }
    else {
      O('soundLowDiskCount8').style.visibility = "hidden";
      O('timesLowDisk8').style.visibility = "hidden";
    }
  }
}
function sizeSettings(){
  if (fixsize.value == "Custom"){
    O('ssize').style.visibility = "visible";
    O('sizetext').style.visibility = "visible";
  }
  else {
    O('ssize').style.visibility = "hidden";
    O('sizetext').style.visibility = "hidden";
  }
}
function graphSettings(){
  if (graph.value == 1){
    O('drawstyle').style.visibility = "visible";
    O('drawtext').style.visibility = "visible";
  }
  else {
    O('drawstyle').style.visibility = "hidden";
    O('drawtext').style.visibility = "hidden";
  }
}
function colorSettings(){
  if (fixBackg.value == ''){
    O('backg').style.visibility = "visible";
    O('showBackg').style.visibility = "hidden";
  }
  else {
    O('backg').style.visibility = "hidden";
    O('showBackg').style.visibility = "visible";
  }
  if (fixTitle.value == ''){
    O('title').style.visibility = "visible";
    O('showTitle').style.visibility = "hidden";
  }
  else {
    O('title').style.visibility = "hidden";
    O('showTitle').style.visibility = "visible";
  }
  if (fixAlertIcon.value == ''){
    O('AlertIcon').style.visibility = "visible";
    O('showAlertIcon').style.visibility = "hidden";
  }
  else {
    O('AlertIcon').style.visibility = "hidden";
    O('showAlertIcon').style.visibility = "visible";
  }
  if (fixtext1.value == ''){
    O('text1').style.visibility = "visible";
    O('showtext1').style.visibility = "hidden";
  }
  else {
    O('text1').style.visibility = "hidden";
    O('showtext1').style.visibility = "visible";
  }
  if (fixpercent1.value == ''){
    O('percent1').style.visibility = "visible";
    O('showpercent1').style.visibility = "hidden";
  }
  else {
    O('percent1').style.visibility = "hidden";
    O('showpercent1').style.visibility = "visible";
  }
  if (fixbar1.value == ''){
    O('bar1').style.visibility = "visible";
    O('showbar1').style.visibility = "hidden";
  }
  else {
    O('bar1').style.visibility = "hidden";
    O('showbar1').style.visibility = "visible";
  }
  if (fixread1.value == ''){
    O('read1').style.visibility = "visible";
    O('showread1').style.visibility = "hidden";
  }
  else {
    O('read1').style.visibility = "hidden";
    O('showread1').style.visibility = "visible";
  }
  if (fixwrite1.value == ''){
    O('write1').style.visibility = "visible";
    O('showwrite1').style.visibility = "hidden";
  }
  else {
    O('write1').style.visibility = "hidden";
    O('showwrite1').style.visibility = "visible";
  }
  if (fixtext2.value == ''){
    O('text2').style.visibility = "visible";
    O('showtext2').style.visibility = "hidden";
  }
  else {
    O('text2').style.visibility = "hidden";
    O('showtext2').style.visibility = "visible";
  }
  if (fixpercent2.value == ''){
    O('percent2').style.visibility = "visible";
    O('showpercent2').style.visibility = "hidden";
  }
  else {
    O('percent2').style.visibility = "hidden";
    O('showpercent2').style.visibility = "visible";
  }
  if (fixbar2.value == ''){
    O('bar2').style.visibility = "visible";
    O('showbar2').style.visibility = "hidden";
  }
  else {
    O('bar2').style.visibility = "hidden";
    O('showbar2').style.visibility = "visible";
  }
  if (fixread2.value == ''){
    O('read2').style.visibility = "visible";
    O('showread2').style.visibility = "hidden";
  }
  else {
    O('read2').style.visibility = "hidden";
    O('showread2').style.visibility = "visible";
  }
  if (fixwrite2.value == ''){
    O('write2').style.visibility = "visible";
    O('showwrite2').style.visibility = "hidden";
  }
  else {
    O('write2').style.visibility = "hidden";
    O('showwrite2').style.visibility = "visible";
  }
  if (fixtext3.value == ''){
    O('text3').style.visibility = "visible";
    O('showtext3').style.visibility = "hidden";
  }
  else {
    O('text3').style.visibility = "hidden";
    O('showtext3').style.visibility = "visible";
  }
  if (fixpercent3.value == ''){
    O('percent3').style.visibility = "visible";
    O('showpercent3').style.visibility = "hidden";
  }
  else {
    O('percent3').style.visibility = "hidden";
    O('showpercent3').style.visibility = "visible";
  }
  if (fixbar3.value == ''){
    O('bar3').style.visibility = "visible";
    O('showbar3').style.visibility = "hidden";
  }
  else {
    O('bar3').style.visibility = "hidden";
    O('showbar3').style.visibility = "visible";
  }
  if (fixread3.value == ''){
    O('read3').style.visibility = "visible";
    O('showread3').style.visibility = "hidden";
  }
  else {
    O('read3').style.visibility = "hidden";
    O('showread3').style.visibility = "visible";
  }
  if (fixwrite3.value == ''){
    O('write3').style.visibility = "visible";
    O('showwrite3').style.visibility = "hidden";
  }
  else {
    O('write3').style.visibility = "hidden";
    O('showwrite3').style.visibility = "visible";
  }
  if (fixtext4.value == ''){
    O('text4').style.visibility = "visible";
    O('showtext4').style.visibility = "hidden";
  }
  else {
    O('text4').style.visibility = "hidden";
    O('showtext4').style.visibility = "visible";
  }
  if (fixpercent4.value == ''){
    O('percent4').style.visibility = "visible";
    O('showpercent4').style.visibility = "hidden";
  }
  else {
    O('percent4').style.visibility = "hidden";
    O('showpercent4').style.visibility = "visible";
  }
  if (fixbar4.value == ''){
    O('bar4').style.visibility = "visible";
    O('showbar4').style.visibility = "hidden";
  }
  else {
    O('bar4').style.visibility = "hidden";
    O('showbar4').style.visibility = "visible";
  }
  if (fixread4.value == ''){
    O('read4').style.visibility = "visible";
    O('showread4').style.visibility = "hidden";
  }
  else {
    O('read4').style.visibility = "hidden";
    O('showread4').style.visibility = "visible";
  }
  if (fixwrite4.value == ''){
    O('write4').style.visibility = "visible";
    O('showwrite4').style.visibility = "hidden";
  }
  else {
    O('write4').style.visibility = "hidden";
    O('showwrite4').style.visibility = "visible";
  }
  if (fixtext5.value == ''){
    O('text5').style.visibility = "visible";
    O('showtext5').style.visibility = "hidden";
  }
  else {
    O('text5').style.visibility = "hidden";
    O('showtext5').style.visibility = "visible";
  }
  if (fixpercent5.value == ''){
    O('percent5').style.visibility = "visible";
    O('showpercent5').style.visibility = "hidden";
  }
  else {
    O('percent5').style.visibility = "hidden";
    O('showpercent5').style.visibility = "visible";
  }
  if (fixbar5.value == ''){
    O('bar5').style.visibility = "visible";
    O('showbar5').style.visibility = "hidden";
  }
  else {
    O('bar5').style.visibility = "hidden";
    O('showbar5').style.visibility = "visible";
  }
  if (fixread5.value == ''){
    O('read5').style.visibility = "visible";
    O('showread5').style.visibility = "hidden";
  }
  else {
    O('read5').style.visibility = "hidden";
    O('showread5').style.visibility = "visible";
  }
  if (fixwrite5.value == ''){
    O('write5').style.visibility = "visible";
    O('showwrite5').style.visibility = "hidden";
  }
  else {
    O('write5').style.visibility = "hidden";
    O('showwrite5').style.visibility = "visible";
  }
  if (fixtext6.value == ''){
    O('text6').style.visibility = "visible";
    O('showtext6').style.visibility = "hidden";
  }
  else {
    O('text6').style.visibility = "hidden";
    O('showtext6').style.visibility = "visible";
  }
  if (fixpercent6.value == ''){
    O('percent6').style.visibility = "visible";
    O('showpercent6').style.visibility = "hidden";
  }
  else {
    O('percent6').style.visibility = "hidden";
    O('showpercent6').style.visibility = "visible";
  }
  if (fixbar6.value == ''){
    O('bar6').style.visibility = "visible";
    O('showbar6').style.visibility = "hidden";
  }
  else {
    O('bar6').style.visibility = "hidden";
    O('showbar6').style.visibility = "visible";
  }
  if (fixread6.value == ''){
    O('read6').style.visibility = "visible";
    O('showread6').style.visibility = "hidden";
  }
  else {
    O('read6').style.visibility = "hidden";
    O('showread6').style.visibility = "visible";
  }
  if (fixwrite6.value == ''){
    O('write6').style.visibility = "visible";
    O('showwrite6').style.visibility = "hidden";
  }
  else {
    O('write6').style.visibility = "hidden";
    O('showwrite6').style.visibility = "visible";
  }
  if (fixtext7.value == ''){
    O('text7').style.visibility = "visible";
    O('showtext7').style.visibility = "hidden";
  }
  else {
    O('text7').style.visibility = "hidden";
    O('showtext7').style.visibility = "visible";
  }
  if (fixpercent7.value == ''){
    O('percent7').style.visibility = "visible";
    O('showpercent7').style.visibility = "hidden";
  }
  else {
    O('percent7').style.visibility = "hidden";
    O('showpercent7').style.visibility = "visible";
  }
  if (fixbar7.value == ''){
    O('bar7').style.visibility = "visible";
    O('showbar7').style.visibility = "hidden";
  }
  else {
    O('bar7').style.visibility = "hidden";
    O('showbar7').style.visibility = "visible";
  }
  if (fixread7.value == ''){
    O('read7').style.visibility = "visible";
    O('showread7').style.visibility = "hidden";
  }
  else {
    O('read7').style.visibility = "hidden";
    O('showread7').style.visibility = "visible";
  }
  if (fixwrite7.value == ''){
    O('write7').style.visibility = "visible";
    O('showwrite7').style.visibility = "hidden";
  }
  else {
    O('write7').style.visibility = "hidden";
    O('showwrite7').style.visibility = "visible";
  }
  if (fixtext8.value == ''){
    O('text8').style.visibility = "visible";
    O('showtext8').style.visibility = "hidden";
  }
  else {
    O('text8').style.visibility = "hidden";
    O('showtext8').style.visibility = "visible";
  }
  if (fixpercent8.value == ''){
    O('percent8').style.visibility = "visible";
    O('showpercent8').style.visibility = "hidden";
  }
  else {
    O('percent8').style.visibility = "hidden";
    O('showpercent8').style.visibility = "visible";
  }
  if (fixbar8.value == ''){
    O('bar8').style.visibility = "visible";
    O('showbar8').style.visibility = "hidden";
  }
  else {
    O('bar8').style.visibility = "hidden";
    O('showbar8').style.visibility = "visible";
  }
  if (fixread8.value == ''){
    O('read8').style.visibility = "visible";
    O('showread8').style.visibility = "hidden";
  }
  else {
    O('read8').style.visibility = "hidden";
    O('showread8').style.visibility = "visible";
  }
  if (fixwrite8.value == ''){
    O('write8').style.visibility = "visible";
    O('showwrite8').style.visibility = "hidden";
  }
  else {
    O('write8').style.visibility = "hidden";
    O('showwrite8').style.visibility = "visible";
  }
  if (fixFlyoutBac.value == ''){
    O('FlyoutBac').style.visibility = "visible";
    O('showFlyoutBac').style.visibility = "hidden";
  }
  else {
    O('FlyoutBac').style.visibility = "hidden";
    O('showFlyoutBac').style.visibility = "visible";
  }
  if (fixFlyoutTit.value == ''){
    O('FlyoutTit').style.visibility = "visible";
    O('showFlyoutTit').style.visibility = "hidden";
  }
  else {
    O('FlyoutTit').style.visibility = "hidden";
    O('showFlyoutTit').style.visibility = "visible";
  }
  if (fixFlyoutDet.value == ''){
    O('FlyoutDet').style.visibility = "visible";
    O('showFlyoutDet').style.visibility = "hidden";
  }
  else {
    O('FlyoutDet').style.visibility = "hidden";
    O('showFlyoutDet').style.visibility = "visible";
  }
}
function showColor(){
  if (fixBackg.value != "")sBackg = fixBackg.value;
  else sBackg = backg.value;
  O('showBackg').style.color = sBackg;
  O('showBackg').style.width = 50;
  O('showBackg').style.height = 21;
  O('showBackg').style.top = 6;
  O('showBackg').style.left = 206;
  if (fixTitle.value != "")sTitle = fixTitle.value;
  else sTitle = title.value;
  O('showTitle').style.color = sTitle;
  O('showTitle').style.width = 50;
  O('showTitle').style.height = 21;
  O('showTitle').style.top = 29;
  O('showTitle').style.left = 206;
  if (fixAlertIcon.value != "")sAlertIcon = fixAlertIcon.value;
  else sAlertIcon = AlertIcon.value;
  O('showAlertIcon').style.color = sAlertIcon;
  O('showAlertIcon').style.width = 50;
  O('showAlertIcon').style.height = 21;
  O('showAlertIcon').style.top = 52;
  O('showAlertIcon').style.left = 206;
  if (fixtext1.value != "")stext1 = fixtext1.value;
  else stext1 = text1.value;
  O('showtext1').style.color = stext1;
  O('showtext1').style.width = 50;
  O('showtext1').style.height = 21;
  O('showtext1').style.top = 105;
  O('showtext1').style.left = 206;
  if (fixpercent1.value != "")spercent1 = fixpercent1.value;
  else spercent1 = percent1.value;
  O('showpercent1').style.color = spercent1;
  O('showpercent1').style.width = 50;
  O('showpercent1').style.height = 21;
  O('showpercent1').style.top = 128;
  O('showpercent1').style.left = 206;
  if (fixbar1.value != "")sbar1 = fixbar1.value;
  else sbar1 = bar1.value;
  O('showbar1').style.color = sbar1;
  O('showbar1').style.width = 50;
  O('showbar1').style.height = 21;
  O('showbar1').style.top = 151;
  O('showbar1').style.left = 206;
  if (fixread1.value != "")sread1 = fixread1.value;
  else sread1 = read1.value;
  O('showread1').style.color = sread1;
  O('showread1').style.width = 50;
  O('showread1').style.height = 21;
  O('showread1').style.top = 174;
  O('showread1').style.left = 206;
  if (fixwrite1.value != "")swrite1 = fixwrite1.value;
  else swrite1 = write1.value;
  O('showwrite1').style.color = swrite1;
  O('showwrite1').style.width = 50;
  O('showwrite1').style.height = 21;
  O('showwrite1').style.top = 197;
  O('showwrite1').style.left = 206;
  if (fixtext2.value != "")stext2 = fixtext2.value;
  else stext2 = text2.value;
  O('showtext2').style.color = stext2;
  O('showtext2').style.width = 50;
  O('showtext2').style.height = 21;
  O('showtext2').style.top = 250;
  O('showtext2').style.left = 206;
  if (fixpercent2.value != "")spercent2 = fixpercent2.value;
  else spercent2 = percent2.value;
  O('showpercent2').style.color = spercent2;
  O('showpercent2').style.width = 50;
  O('showpercent2').style.height = 21;
  O('showpercent2').style.top = 273;
  O('showpercent2').style.left = 206;
  if (fixbar2.value != "")sbar2 = fixbar2.value;
  else sbar2 = bar2.value;
  O('showbar2').style.color = sbar2;
  O('showbar2').style.width = 50;
  O('showbar2').style.height = 21;
  O('showbar2').style.top = 296;
  O('showbar2').style.left = 206;
  if (fixread2.value != "")sread2 = fixread2.value;
  else sread2 = read2.value;
  O('showread2').style.color = sread2;
  O('showread2').style.width = 50;
  O('showread2').style.height = 21;
  O('showread2').style.top = 319;
  O('showread2').style.left = 206;
  if (fixwrite2.value != "")swrite2 = fixwrite2.value;
  else swrite2 = write2.value;
  O('showwrite2').style.color = swrite2;
  O('showwrite2').style.width = 50;
  O('showwrite2').style.height = 21;
  O('showwrite2').style.top = 342;
  O('showwrite2').style.left = 206;
  if (fixtext3.value != "")stext3 = fixtext3.value;
  else stext3 = text3.value;
  O('showtext3').style.color = stext3;
  O('showtext3').style.width = 50;
  O('showtext3').style.height = 21;
  O('showtext3').style.top = 395;
  O('showtext3').style.left = 206;
  if (fixpercent3.value != "")spercent3 = fixpercent3.value;
  else spercent3 = percent3.value;
  O('showpercent3').style.color = spercent3;
  O('showpercent3').style.width = 50;
  O('showpercent3').style.height = 21;
  O('showpercent3').style.top = 418;
  O('showpercent3').style.left = 206;
  if (fixbar3.value != "")sbar3 = fixbar3.value;
  else sbar3 = bar3.value;
  O('showbar3').style.color = sbar3;
  O('showbar3').style.width = 50;
  O('showbar3').style.height = 21;
  O('showbar3').style.top = 441;
  O('showbar3').style.left = 206;
  if (fixread3.value != "")sread3 = fixread3.value;
  else sread3 = read3.value;
  O('showread3').style.color = sread3;
  O('showread3').style.width = 50;
  O('showread3').style.height = 21;
  O('showread3').style.top = 464;
  O('showread3').style.left = 206;
  if (fixwrite3.value != "")swrite3 = fixwrite3.value;
  else swrite3 = write3.value;
  O('showwrite3').style.color = swrite3;
  O('showwrite3').style.width = 50;
  O('showwrite3').style.height = 21;
  O('showwrite3').style.top = 487;
  O('showwrite3').style.left = 206;
  if (fixtext4.value != "")stext4 = fixtext4.value;
  else stext4 = text4.value;
  O('showtext4').style.color = stext4;
  O('showtext4').style.width = 50;
  O('showtext4').style.height = 21;
  O('showtext4').style.top = 540;
  O('showtext4').style.left = 206;
  if (fixpercent4.value != "")spercent4 = fixpercent4.value;
  else spercent4 = percent4.value;
  O('showpercent4').style.color = spercent4;
  O('showpercent4').style.width = 50;
  O('showpercent4').style.height = 21;
  O('showpercent4').style.top = 563;
  O('showpercent4').style.left = 206;
  if (fixbar4.value != "")sbar4 = fixbar4.value;
  else sbar4 = bar4.value;
  O('showbar4').style.color = sbar4;
  O('showbar4').style.width = 50;
  O('showbar4').style.height = 21;
  O('showbar4').style.top = 586;
  O('showbar4').style.left = 206;
  if (fixread4.value != "")sread4 = fixread4.value;
  else sread4 = read4.value;
  O('showread4').style.color = sread4;
  O('showread4').style.width = 50;
  O('showread4').style.height = 21;
  O('showread4').style.top = 609;
  O('showread4').style.left = 206;
  if (fixwrite4.value != "")swrite4 = fixwrite4.value;
  else swrite4 = write4.value;
  O('showwrite4').style.color = swrite4;
  O('showwrite4').style.width = 50;
  O('showwrite4').style.height = 21;
  O('showwrite4').style.top = 632;
  O('showwrite4').style.left = 206;
  if (fixtext5.value != "")stext5 = fixtext5.value;
  else stext5 = text5.value;
  O('showtext5').style.color = stext5;
  O('showtext5').style.width = 50;
  O('showtext5').style.height = 21;
  O('showtext5').style.top = 685;
  O('showtext5').style.left = 206;
  if (fixpercent5.value != "")spercent5 = fixpercent5.value;
  else spercent5 = percent5.value;
  O('showpercent5').style.color = spercent5;
  O('showpercent5').style.width = 50;
  O('showpercent5').style.height = 21;
  O('showpercent5').style.top = 708;
  O('showpercent5').style.left = 206;
  if (fixbar5.value != "")sbar5 = fixbar5.value;
  else sbar5 = bar5.value;
  O('showbar5').style.color = sbar5;
  O('showbar5').style.width = 50;
  O('showbar5').style.height = 21;
  O('showbar5').style.top = 731;
  O('showbar5').style.left = 206;
  if (fixread5.value != "")sread5 = fixread5.value;
  else sread5 = read5.value;
  O('showread5').style.color = sread5;
  O('showread5').style.width = 50;
  O('showread5').style.height = 21;
  O('showread5').style.top = 754;
  O('showread5').style.left = 206;
  if (fixwrite5.value != "")swrite5 = fixwrite5.value;
  else swrite5 = write5.value;
  O('showwrite5').style.color = swrite5;
  O('showwrite5').style.width = 50;
  O('showwrite5').style.height = 21;
  O('showwrite5').style.top = 777;
  O('showwrite5').style.left = 206;
  if (fixtext6.value != "")stext6 = fixtext6.value;
  else stext6 = text6.value;
  O('showtext6').style.color = stext6;
  O('showtext6').style.width = 50;
  O('showtext6').style.height = 21;
  O('showtext6').style.top = 830;
  O('showtext6').style.left = 206;
  if (fixpercent6.value != "")spercent6 = fixpercent6.value;
  else spercent6 = percent6.value;
  O('showpercent6').style.color = spercent6;
  O('showpercent6').style.width = 50;
  O('showpercent6').style.height = 21;
  O('showpercent6').style.top = 853;
  O('showpercent6').style.left = 206;
  if (fixbar6.value != "")sbar6 = fixbar6.value;
  else sbar6 = bar6.value;
  O('showbar6').style.color = sbar6;
  O('showbar6').style.width = 50;
  O('showbar6').style.height = 21;
  O('showbar6').style.top = 876;
  O('showbar6').style.left = 206;
  if (fixread6.value != "")sread6 = fixread6.value;
  else sread6 = read6.value;
  O('showread6').style.color = sread6;
  O('showread6').style.width = 50;
  O('showread6').style.height = 21;
  O('showread6').style.top = 899;
  O('showread6').style.left = 206;
  if (fixwrite6.value != "")swrite6 = fixwrite6.value;
  else swrite6 = write6.value;
  O('showwrite6').style.color = swrite6;
  O('showwrite6').style.width = 50;
  O('showwrite6').style.height = 21;
  O('showwrite6').style.top = 922;
  O('showwrite6').style.left = 206;
  if (fixtext7.value != "")stext7 = fixtext7.value;
  else stext7 = text7.value;
  O('showtext7').style.color = stext7;
  O('showtext7').style.width = 50;
  O('showtext7').style.height = 21;
  O('showtext7').style.top = 975;
  O('showtext7').style.left = 206;
  if (fixpercent7.value != "")spercent7 = fixpercent7.value;
  else spercent7 = percent7.value;
  O('showpercent7').style.color = spercent7;
  O('showpercent7').style.width = 50;
  O('showpercent7').style.height = 21;
  O('showpercent7').style.top = 998;
  O('showpercent7').style.left = 206;
  if (fixbar7.value != "")sbar7 = fixbar7.value;
  else sbar7 = bar7.value;
  O('showbar7').style.color = sbar7;
  O('showbar7').style.width = 50;
  O('showbar7').style.height = 21;
  O('showbar7').style.top = 1021;
  O('showbar7').style.left = 206;
  if (fixread7.value != "")sread7 = fixread7.value;
  else sread7 = read7.value;
  O('showread7').style.color = sread7;
  O('showread7').style.width = 50;
  O('showread7').style.height = 21;
  O('showread7').style.top = 1044;
  O('showread7').style.left = 206;
  if (fixwrite7.value != "")swrite7 = fixwrite7.value;
  else swrite7 = write7.value;
  O('showwrite7').style.color = swrite7;
  O('showwrite7').style.width = 50;
  O('showwrite7').style.height = 21;
  O('showwrite7').style.top = 1067;
  O('showwrite7').style.left = 206;
  if (fixtext8.value != "")stext8 = fixtext8.value;
  else stext8 = text8.value;
  O('showtext8').style.color = stext8;
  O('showtext8').style.width = 50;
  O('showtext8').style.height = 21;
  O('showtext8').style.top = 1120;
  O('showtext8').style.left = 206;
  if (fixpercent8.value != "")spercent8 = fixpercent8.value;
  else spercent8 = percent8.value;
  O('showpercent8').style.color = spercent8;
  O('showpercent8').style.width = 50;
  O('showpercent8').style.height = 21;
  O('showpercent8').style.top = 1143;
  O('showpercent8').style.left = 206;
  if (fixbar8.value != "")sbar8 = fixbar8.value;
  else sbar8 = bar8.value;
  O('showbar8').style.color = sbar8;
  O('showbar8').style.width = 50;
  O('showbar8').style.height = 21;
  O('showbar8').style.top = 1166;
  O('showbar8').style.left = 206;
  if (fixread8.value != "")sread8 = fixread8.value;
  else sread8 = read8.value;
  O('showread8').style.color = sread8;
  O('showread8').style.width = 50;
  O('showread8').style.height = 21;
  O('showread8').style.top = 1189;
  O('showread8').style.left = 206;
  if (fixwrite8.value != "")swrite8 = fixwrite8.value;
  else swrite8 = write8.value;
  O('showwrite8').style.color = swrite8;
  O('showwrite8').style.width = 50;
  O('showwrite8').style.height = 21;
  O('showwrite8').style.top = 1212;
  O('showwrite8').style.left = 206;
  if (fixFlyoutBac.value != "")sFlyoutBac = fixFlyoutBac.value;
  else sFlyoutBac = FlyoutBac.value;
  O('showFlyoutBac').style.color = sFlyoutBac;
  O('showFlyoutBac').style.width = 50;
  O('showFlyoutBac').style.height = 21;
  O('showFlyoutBac').style.top = 1265;
  O('showFlyoutBac').style.left = 206;
  if (fixFlyoutTit.value != "")sFlyoutTit = fixFlyoutTit.value;
  else sFlyoutTit = FlyoutTit.value;
  O('showFlyoutTit').style.color = sFlyoutTit;
  O('showFlyoutTit').style.width = 50;
  O('showFlyoutTit').style.height = 21;
  O('showFlyoutTit').style.top = 1288;
  O('showFlyoutTit').style.left = 206;
  if (fixFlyoutDet.value != "")sFlyoutDet = fixFlyoutDet.value;
  else sFlyoutDet = FlyoutDet.value;
  O('showFlyoutDet').style.color = sFlyoutDet;
  O('showFlyoutDet').style.width = 50;
  O('showFlyoutDet').style.height = 21;
  O('showFlyoutDet').style.top = 1317;
  O('showFlyoutDet').style.left = 206;
}
function getURL(a){
  try {
    var xmlReq = new ActiveXObject("Microsoft.XMLHTTP");
    xmlReq.open("GET", a, false);
    xmlReq.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2000 00:00:00 GMT");
    xmlReq.send();
    if (xmlReq.status == 200){
        return xmlReq.responseText;
    }
    else {
        return false;
    }
  }
  catch (urlData){
      return false;
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
function showUpdate(){
  if (updateAvailable()){
      O("newUpdate").style.display = "block";
  }
  else {
      O("noUpdate").style.display = "block";
  }
}
function DefOptionsSetting(){
  settimer.value = 1;
  alertDrive.value = 2;
  alertLowDisk1.value = 1;
  alertLowDiskBelow1.value = 1;
  alertLowDiskByt1.value = 2;
  soundLowDisk1.value = 1;
  soundLowDiskurl1.innerText = '';
  soundLowDiskVol1.value = 100;
  soundLowDiskRepeats1.value = 3;
  soundLowDiskCount1.value = 1;
  showDrive2.value = 1;
  alertLowDisk2.value = 1;
  alertLowDiskBelow2.value = 1;
  alertLowDiskByt2.value = 2;
  soundLowDisk2.value = 1;
  soundLowDiskurl2.innerText = '';
  soundLowDiskVol2.value = 100;
  soundLowDiskRepeats2.value = 3;
  soundLowDiskCount2.value = 1;
  showDrive3.value = 1;
  alertLowDisk3.value = 1;
  alertLowDiskBelow3.value = 1;
  alertLowDiskByt3.value = 2;
  soundLowDisk3.value = 1;
  soundLowDiskurl3.innerText = '';
  soundLowDiskVol3.value = 100;
  soundLowDiskRepeats3.value = 3;
  soundLowDiskCount3.value = 1;
  showDrive4.value = 1;
  alertLowDisk4.value = 1;
  alertLowDiskBelow4.value = 1;
  alertLowDiskByt4.value = 2;
  soundLowDisk4.value = 1;
  soundLowDiskurl4.innerText = '';
  soundLowDiskVol4.value = 100;
  soundLowDiskRepeats4.value = 3;
  soundLowDiskCount4.value = 1;
  showDrive5.value = 1;
  alertLowDisk5.value = 1;
  alertLowDiskBelow5.value = 1;
  alertLowDiskByt5.value = 2;
  soundLowDisk5.value = 1;
  soundLowDiskurl5.innerText = '';
  soundLowDiskVol5.value = 100;
  soundLowDiskRepeats5.value = 3;
  soundLowDiskCount5.value = 1;
  showDrive6.value = 1;
  alertLowDisk6.value = 1;
  alertLowDiskBelow6.value = 1;
  alertLowDiskByt6.value = 2;
  soundLowDisk6.value = 1;
  soundLowDiskurl6.innerText = '';
  soundLowDiskVol6.value = 100;
  soundLowDiskRepeats6.value = 3;
  soundLowDiskCount6.value = 1;
  showDrive7.value = 1;
  alertLowDisk7.value = 1;
  alertLowDiskBelow7.value = 1;
  alertLowDiskByt7.value = 2;
  soundLowDisk7.value = 1;
  soundLowDiskurl7.innerText = '';
  soundLowDiskVol7.value = 100;
  soundLowDiskRepeats7.value = 3;
  soundLowDiskCount7.value = 1;
  showDrive8.value = 1;
  alertLowDisk8.value = 1;
  alertLowDiskBelow8.value = 1;
  alertLowDiskByt8.value = 2;
  soundLowDisk8.value = 1;
  soundLowDiskurl8.innerText = '';
  soundLowDiskVol8.value = 100;
  soundLowDiskRepeats8.value = 3;
  soundLowDiskCount8.value = 1;
}
function DefDisplaySetting(){
  fixsize.value = 100;
  ssize.value = 100;
  fixUnit.value = 1;
  graph.value = 1;
  drawstyle.value = 0;
  ScaleType.value = 0;
  ScaleSize.value = "";
  update.value = 1;
}
function DefColorSetting(){
  backg.value = "080808";
  fixBackg.value = "";
  title.value = "FFFFFF";
  fixTitle.value = "";
  AlertIcon.value = "90EE90";
  fixAlertIcon.value = "";
  text1.value = "87CEFA";
  fixtext1.value = "";
  percent1.value = "E5316C";
  fixpercent1.value = "";
  bar1.value = "FFF62A";
  fixbar1.value = "";
  read1.value = "90EE90";
  fixread1.value = "";
  write1.value = "FFF62A";
  fixwrite1.value = "";
  text2.value = "87CEFA";
  fixtext2.value = "";
  percent2.value = "E2003B";
  fixpercent2.value = "";
  bar2.value = "FFF62A";
  fixbar2.value = "";
  read2.value = "79B63E";
  fixread2.value = "";
  write2.value = "FABA00";
  fixwrite2.value = "";
  text3.value = "87CEFA";
  fixtext3.value = "";
  percent3.value = "D7007A";
  fixpercent3.value = "";
  bar3.value = "FFF62A";
  fixbar3.value = "";
  read3.value = "64C566";
  fixread3.value = "";
  write3.value = "EC7527";
  fixwrite3.value = "";
  text4.value = "87CEFA";
  fixtext4.value = "";
  percent4.value = "AE3288";
  fixpercent4.value = "";
  bar4.value = "FFF62A";
  fixbar4.value = "";
  read4.value = "4DB896";
  fixread4.value = "";
  write4.value = "9C640A";
  fixwrite4.value = "";
  text5.value = "87CEFA";
  fixtext5.value = "";
  percent5.value = "E5316C";
  fixpercent5.value = "";
  bar5.value = "FFF62A";
  fixbar5.value = "";
  read5.value = "90EE90";
  fixread5.value = "";
  write5.value = "FFF62A";
  fixwrite5.value = "";
  text6.value = "87CEFA";
  fixtext6.value = "";
  percent6.value = "E2003B";
  fixpercent6.value = "";
  bar6.value = "FFF62A";
  fixbar6.value = "";
  read6.value = "79B63E";
  fixread6.value = "";
  write6.value = "FABA00";
  fixwrite6.value = "";
  text7.value = "87CEFA";
  fixtext7.value = "";
  percent7.value = "D7007A";
  fixpercent7.value = "";
  bar7.value = "FFF62A";
  fixbar7.value = "";
  read7.value = "64C566";
  fixread7.value = "";
  write7.value = "EC7527";
  fixwrite7.value = "";
  text8.value = "87CEFA";
  fixtext8.value = "";
  percent8.value = "AE3288";
  fixpercent8.value = "";
  bar8.value = "FFF62A";
  fixbar8.value = "";
  read8.value = "4DB896";
  fixread8.value = "";
  write8.value = "9C640A";
  fixwrite8.value = "";
  FlyoutBac.value = "080808";
  fixFlyoutBac.value = "";
  FlyoutTit.value = "87CEFA";
  fixFlyoutTit.value = "";
  FlyoutDet.value = "FFCC00";
  fixFlyoutDet.value = "";
}
function tabberObj(argsObj){
  var arg;
  this .div = null;
  this .classMain = "tabber";
  this .classMainLive = "tabberlive";
  this .classTab = "tabbertab";
  this .classTabDefault = "tabbertabdefault";
  this .classNav = "tabbernav";
  this .classTabHide = "tabbertabhide";
  this .classNavActive = "tabberactive";
  this .titleElements = ['h2', 'h3', 'h4', 'h5', 'h6'];
  this .titleElementsStripHTML = true;
  this .removeTitle = true;
  this .addLinkId = false;
  this .linkIdFormat = '<tabberid>nav<tabnumberone>';
  for (arg in argsObj){
    this [arg] = argsObj[arg];
  }
  this .REclassMain = new RegExp('\\b' + this .classMain + '\\b', 'gi');
  this .REclassMainLive = new RegExp('\\b' + this .classMainLive + '\\b', 'gi');
  this .REclassTab = new RegExp('\\b' + this .classTab + '\\b', 'gi');
  this .REclassTabDefault = new RegExp('\\b' + this .classTabDefault + '\\b', 'gi');
  this .REclassTabHide = new RegExp('\\b' + this .classTabHide + '\\b', 'gi');
  this .tabs = new Array();
  if (this .div){
    this .init(this .div);
    this .div = null;
  }
}
tabberObj.prototype.init = function (e){
  var childNodes, i, i2, t, defaultTab = 0, DOM_ul, DOM_li, DOM_a, aId, headingElement;
  if (!document.getElementsByTagName){
    return false;
  }
  if (e.id){
    this .id = e.id;
  }
  this .tabs.length = 0;
  childNodes = e.childNodes;
  for (i = 0; i < childNodes.length; i ++ ){
    if (childNodes[i].className && childNodes[i].className.match(this .REclassTab)){
      t = new Object();
      t.div = childNodes[i];
      this .tabs[this .tabs.length] = t;
      if (childNodes[i].className.match(this .REclassTabDefault)){
        defaultTab = this .tabs.length - 1;
      }
    }
  }
  DOM_ul = document.createElement("ul");
  DOM_ul.className = this .classNav;
  for (i = 0; i < this .tabs.length; i ++ ){
    t = this .tabs[i];
    t.headingText = t.div.title;
    if (this .removeTitle){
      t.div.title = '';
    }
    if (!t.headingText){
      for (i2 = 0; i2 < this .titleElements.length; i2 ++ ){
        headingElement = t.div.getElementsByTagName(this .titleElements[i2])[0];
        if (headingElement){
          t.headingText = headingElement.innerHTML;
          if (this .titleElementsStripHTML){
            t.headingText.replace(/<br>/gi, " ");
            t.headingText = t.headingText.replace(/<[^>]+>/g, "");
          }
          break ;
        }
      }
    }
    if (!t.headingText){
      t.headingText = i + 1;
    }
    DOM_li = document.createElement("li");
    t.li = DOM_li;
    DOM_a = document.createElement("a");
    DOM_a.appendChild(document.createTextNode(t.headingText));
    DOM_a.href = "javascript:void(null);";
    DOM_a.title = t.headingText;
    DOM_a.onclick = this .navClick;
    DOM_a.tabber = this ;
    DOM_a.tabberIndex = i;
    if (this .addLinkId && this .linkIdFormat){
      aId = this .linkIdFormat;
      aId = aId.replace(/<tabberid>/gi, this .id);
      aId = aId.replace(/<tabnumberzero>/gi, i);
      aId = aId.replace(/<tabnumberone>/gi, i + 1);
      aId = aId.replace(/<tabtitle>/gi, t.headingText.replace(/[^a-zA-Z0-9\-]/gi, ''));
      DOM_a.id = aId;
    }
    DOM_li.appendChild(DOM_a);
    DOM_ul.appendChild(DOM_li);
  }
  e.insertBefore(DOM_ul, e.firstChild);
  e.className = e.className.replace(this .REclassMain, this .classMainLive);
  this .tabShow(defaultTab);
  if (typeof this .onLoad == 'function'){
    this .onLoad({
      tabber : this 
    }
    );
  }
  return this ;
}
;
tabberObj.prototype.navClick = function (event){
  var rVal, a, self, tabberIndex, onClickArgs;
  a = this ;
  if (!a.tabber){
    return false;
  }
  self = a.tabber;
  tabberIndex = a.tabberIndex;
  a.blur();
  if (typeof self.onClick == 'function'){
    onClickArgs = {
      'tabber' : self, 'index' : tabberIndex, 'event' : event
    }
    ;
    if (!event){
      onClickArgs.event = window.event;
    }
    rVal = self.onClick(onClickArgs);
    if (rVal === false){
      return false;
    }
  }
  self.tabShow(tabberIndex);
  return false;
}
;
tabberObj.prototype.tabHideAll = function (){
  var i;
  for (i = 0; i < this .tabs.length; i ++ ){
    this .tabHide(i);
  }
}
;
tabberObj.prototype.tabHide = function (tabberIndex){
  var div;
  if (!this .tabs[tabberIndex]){
    return false;
  }
  div = this .tabs[tabberIndex].div;
  if (!div.className.match(this .REclassTabHide)){
    div.className += ' ' + this .classTabHide;
  }
  this .navClearActive(tabberIndex);
  return this ;
}
;
tabberObj.prototype.tabShow = function (tabberIndex){
  var div;
  if (!this .tabs[tabberIndex]){
    return false;
  }
  this .tabHideAll();
  div = this .tabs[tabberIndex].div;
  div.className = div.className.replace(this .REclassTabHide, '');
  this .navSetActive(tabberIndex);
  if (typeof this .onTabDisplay == 'function'){
    this .onTabDisplay({
      'tabber' : this , 'index' : tabberIndex
    }
    );
  }
  return this ;
}
;
tabberObj.prototype.navSetActive = function (tabberIndex){
  this .tabs[tabberIndex].li.className = this .classNavActive;
  return this ;
}
;
tabberObj.prototype.navClearActive = function (tabberIndex){
  this .tabs[tabberIndex].li.className = '';
  return this ;
}
;
function tabberAutomatic(tabberArgs){
  var tempObj, divs, i;
  if (!tabberArgs){
    tabberArgs = {
    }
    ;
  }
  tempObj = new tabberObj(tabberArgs);
  divs = document.getElementsByTagName("div");
  for (i = 0; i < divs.length; i ++ ){
    if (divs[i].className && divs[i].className.match(tempObj.REclassMain)){
      tabberArgs.div = divs[i];
      divs[i].tabber = new tabberObj(tabberArgs);
    }
  }
  return this ;
}
function tabberAutomaticOnLoad(tabberArgs){
  var oldOnLoad;
  if (!tabberArgs){
    tabberArgs = {
    }
    ;
  }
  oldOnLoad = window.onload;
  if (typeof window.onload != 'function'){
    window.onload = function (){
      tabberAutomatic(tabberArgs);
    }
    ;
  }
  else {
    window.onload = function (){
      oldOnLoad();
      tabberAutomatic(tabberArgs);
    }
    ;
  }
}
if (typeof tabberOptions == 'undefined'){
  tabberAutomaticOnLoad();
}
else {
  if (!tabberOptions['manualStartup']){
    tabberAutomaticOnLoad(tabberOptions);
  }
}
