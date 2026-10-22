/*

_SA.js (v4.6.1)

System Animator
(c) Butz Yung / Anime Theme. All rights reserved.
- Homepage: http://www.animetheme.com/


Credits:
- sun (http://www.solaris-computers.com/)
- All authors of the images used in this application

*/


// SEQ HTML+TIME mode START
var Seq_speed_delay = System.Gadget.Settings.readString("TimerDelay")
if (!Seq_speed_delay)
  Seq_speed_delay = Settings_default.TimerDelay
Seq_speed_delay = parseFloat(Seq_speed_delay)

// (Yozora #629) no HTML+TIME in this browser: the JavaScript timer, as on IE 9
if (false && !ie9 && (Seq_speed_delay >= 1))
  Seq_HT_enabled = true
else {
  Seq_HT_enabled = false
  Seq_speed_delay = 1
}
// END


function toFileProtocol(url) {
  return "file:///" + url.replace(/^(\w)\:/, "$1|").replace(/\\/g, "/")
}

function toLocalPath(url) {
  return url.replace(/^file\:\/+(\w)\|/, "$1:").replace(/\//g, "\\")
}

function addZero(n, d) {
  if (!d)
    d = 2

  n += ""

  if (n.length >= d)
    return n

  n = Math.pow(10,d-n.length) + n
  return n.substring(1, n.length)
}

function random(num) {
  return Math.floor(Math.random() * num)
}

var loaded
var use_Silverlight_only
var use_Silverlight = returnBoolean("UseSilverlight")
var use_HTML5// = (use_Silverlight && ie9_mode)
var use_SVG// = (use_Silverlight && ie9_mode)
var use_Silverlight_only = (use_Silverlight && !use_HTML5 && !use_SVG)

var Vista_or_above = /Windows NT [6-9]/i.test(navigator.userAgent)
var Shell_OBJ
if (!Vista_or_above) {
  try {
    Shell_OBJ = new ActiveXObject("Shell.Application");
  }
  catch (err) {}
}


// For debug START
var DEBUG_count = 0
var DEBUG_timerID
var DEBUG_always_visible

function DEBUG_show(msg, hide_sec, always_visible) {
  if (always_visible)
    DEBUG_always_visible = true

  if (DEBUG_timerID || DEBUG_always_visible)
    msg = Ldebug.innerText + " | " + msg

  if (DEBUG_timerID) {
    clearTimeout(DEBUG_timerID)
    DEBUG_timerID = null

    if (hide_sec)
      hide_sec += 1
  }

  if (msg || (msg == 0)) {
    Ldebug.innerText = msg

    if (!self.use_Silverlight || !self.SL_DEBUG_show || self.SL_windowless)
      Ldebug.style.visibility = "inherit"

    if (hide_sec && !DEBUG_always_visible)
      DEBUG_timerID = setTimeout('DEBUG_timerID=null; DEBUG_show()', hide_sec*1000)
  }
  else
    Ldebug.style.visibility = "hidden"

// Silverlight START
  if (self.SL_DEBUG_show)
    SL_DEBUG_show(msg)
}
// For debug END


function init() {
  loaded = true

  System.Gadget.onDock = CheckDockState;
  System.Gadget.onUndock = CheckDockState;

  System.Gadget.settingsUI = "settings.html"
  System.Gadget.onSettingsClosed = SettingsClosed;

// main
  Seq.item("Animate").At(0.1, "Animate", -1, 0.1)
  Seq.item("Animate").Play()

  if (SEQ_mode) {
    Seq.item("SEQ").At(0, "SEQ_Animate", -1, 0.1)
    Seq.item("SEQ").Play()
  }

  if (MacFace_mode)
    VistaFace.main()

  if (!BG_dim_calculate) {
    BG_dim_calculate = function () {
      if (!self.EV_width)
        EV_width_no_init = true
      if (!self.EV_height)
        EV_height_no_init = true

      if (EV_width_no_init)
        EV_width  = ((w_max > 130) ? 130 : w_max)
      if (EV_height_no_init)
        EV_height = ((h_max > 130) ? 130 : h_max)
    }
  }

  DragDrop.init(document.body, DragDrop_install, function (item) { return (item.isFolder || (item.isFileSystem && DragDrop_RE.test(item.path))) })

  loadMain()
}

var DragDrop_RE_default = /\.(bmp|gif|jpg|jpeg|png|wmv|mp4)$/i
var DragDrop_RE = DragDrop_RE_default

function DragDrop_install(item) {
  System.Gadget.Settings.writeString("Folder", item.path)

  setTimeout('self.location.href = self.location.href', 0)
}

var Settings = {}

var WMI_ev_obj
var WMI_ev_objVF
var WMI_ev_obj_pages
var drive_letter_default, drive_letter_system
var drive_letter_defaultVF, drive_letter_systemVF


var path_demo = {
   demo1: System.Gadget.path + "\\images\\xpmce_tan"
  ,demo2: System.Gadget.path + "\\images\\2k_tan.SEQ-1-1"
  ,demo3: System.Gadget.path + "\\images\\flag_usa"
  ,demo4: System.Gadget.path + "\\images\\flag_uk"
  ,demo5: System.Gadget.path + "\\images\\matrix_js"
  ,demo8: System.Gadget.path + "\\images\\Matrix_PC_Meter"
  ,demo6: System.Gadget.path + "\\images\\MacFace01.mcface"
  ,demo7: System.Gadget.path + "\\images\\CaramellDansen_Popotan.SEQ-2-30"
  ,demo9: System.Gadget.path + "\\images\\SlideShow_Deluxe"
  // the anime animation packs (sys_ani_*.zip), unpacked into packs\\ (Yozora #629)
  ,demo10: System.Gadget.path + "\\packs\\sys_ani_haruhi_suzumiya\\haruhi suzumiya\\haruhi - macface - haruhi.mcface"
  ,demo11: System.Gadget.path + "\\packs\\sys_ani_haruhi_suzumiya\\haruhi suzumiya\\haruhi ed full v2 - ss - jpeg.seq-1-1"
  ,demo12: System.Gadget.path + "\\packs\\sys_ani_haruhi_suzumiya\\haruhi suzumiya\\haruhi misc.seq-1-1"
  ,demo13: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on - azusa neko 01.seq-2-15"
  ,demo14: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on - azusa neko 02.seq-2-15"
  ,demo15: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on - mio - kitty mascot - png.seq-1-5"
  ,demo16: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on - poor neko mio.seq-1-1"
  ,demo17: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on - ss - jpeg.seq-1-1"
  ,demo18: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on ancient band.seq-1-20"
  ,demo19: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\k-on mmd yui and mio - small.seq-1-1"
  ,demo20: System.Gadget.path + "\\packs\\sys_ani_k_on\\k-on\\mio - mascot_v4.seq-1-1"
  ,demo21: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - all star - deluxe.seq-1-1"
  ,demo22: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - cheerleading team - ss - jpeg.seq-1-1"
  ,demo23: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - kagami - kitty mascot - png.seq-1-5"
  ,demo24: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - kagami sleepless"
  ,demo25: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - konata bored"
  ,demo26: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - konata and kagami"
  ,demo27: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - konata and volleyball"
  ,demo28: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\lucky star - tsukasa and her cell phone"
  ,demo29: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\sun - lucky star - macface - kagami.sunmod.mcface"
  ,demo30: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\sun - lucky star - macface - konata.sunmod.mcface"
  ,demo31: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\sun - lucky star - macface - miyuki.mcface"
  ,demo32: System.Gadget.path + "\\packs\\sys_ani_lucky_star\\lucky star\\sun - lucky star - macface - tsukasa.sunmod.mcface"
  ,demo33: System.Gadget.path + "\\packs\\sys_ani_others\\others\\caramelldansen - deluxe.seq-1-1"
  ,demo34: System.Gadget.path + "\\packs\\sys_ani_others\\others\\chun li"
  ,demo35: System.Gadget.path + "\\packs\\sys_ani_others\\others\\chun li - mascot.seq-1-1"
  ,demo36: System.Gadget.path + "\\packs\\sys_ani_others\\others\\durarara - slideshow gallery merry-go-round_v4.seq-1-1"
  ,demo37: System.Gadget.path + "\\packs\\sys_ani_others\\others\\ino - mascot.seq-1-1"
  ,demo38: System.Gadget.path + "\\packs\\sys_ani_others\\others\\mai"
  ,demo39: System.Gadget.path + "\\packs\\sys_ani_others\\others\\mai - mascot.seq-1-1"
  ,demo40: System.Gadget.path + "\\packs\\sys_ani_others\\others\\matrix x ghost in the shell - js"
  ,demo41: System.Gadget.path + "\\packs\\sys_ani_others\\others\\matrix x vocaloid miku - js"
  ,demo42: System.Gadget.path + "\\packs\\sys_ani_others\\others\\michael jackson - moonwalker.seq-1-1"
  ,demo43: System.Gadget.path + "\\packs\\sys_ani_others\\others\\misc01.seq-2-20"
  ,demo44: System.Gadget.path + "\\packs\\sys_ani_others\\others\\misc02.seq-2-20"
  ,demo45: System.Gadget.path + "\\packs\\sys_ani_others\\others\\reisen.seq-2-30"
  ,demo46: System.Gadget.path + "\\packs\\sys_ani_others\\others\\sakura"
  ,demo47: System.Gadget.path + "\\packs\\sys_ani_others\\others\\sakura - mascot.seq-2-30"
  ,demo48: System.Gadget.path + "\\packs\\sys_ani_others\\others\\slideshow gallery merry-go-round_v4.seq-1-1"
  ,demo49: System.Gadget.path + "\\packs\\sys_ani_others\\others\\sonics.seq-1-1"
  ,demo50: System.Gadget.path + "\\packs\\sys_ani_others\\others\\xp tan - mascot.seq-1-1"
  ,demo51: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\project diva - vocaloid miku - dear cocoa girls - ss - jpeg.seq-1-1"
  ,demo52: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\project diva - vocaloid miku - marginal - ss - jpeg.seq-1-1"
  ,demo53: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\project diva - vocaloid miku - miku miku - ss - jpeg.seq-1-1"
  ,demo54: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\project diva - vocaloid miku - the secret garden - ss - jpeg.seq-1-1"
  ,demo55: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\project diva - vocaloid miku - world is mine - ss - jpeg.seq-1-1"
  ,demo56: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid - misc - deluxe.seq-1-1"
  ,demo57: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid kaito - mascot.seq-2-20"
  ,demo58: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid luka - mascot.seq-2-30"
  ,demo59: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid luka - matrix meter_v2.seq-1-1"
  ,demo60: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid luka - tako x shark.seq-2-30"
  ,demo61: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot"
  ,demo62: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - 01_v2.seq-1-1"
  ,demo63: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - 02_v2.seq-1-1"
  ,demo64: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - cheerleader.seq-1-1"
  ,demo65: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - mini_v2.seq-1-1"
  ,demo66: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - mini_v2_png_aa.seq-1-1"
  ,demo67: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - mascot - super cute_v3"
  ,demo68: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - moonlight miku.seq-2-15"
  ,demo69: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloid miku - rainbow series.seq-2-20"
  ,demo70: System.Gadget.path + "\\packs\\sys_ani_vocaloids\\vocaloids\\vocaloids - rosario and vampire capu2 - ss - jpeg.seq-1-1"
}
var f_path_default = path_demo[Settings_default.Folder]

var bar_color = [
  null,
  ["#51C6E2", "#0A809B"],
  ["#6DE298", "#34AA53"],
  ["#E1B775", "#DA7C0C"],
  ["#E296F6", "#CE5AD9"],
  ["#c0a0f0", "#905be5"],
  ["#6090e0", "#2b6dd5"],
  ["#f0b0c0", "#e67a96"],
  ["#31cfcc", "#249c9a"]
]

var EventToMonitor_para1
var EventToMonitor_para2

function parseEventToMonitor() {
  var ev = Settings.EventToMonitor
  if (/CPU/.test(ev)) {
    EventToMonitor_para1 = (/(\d+)/.test(ev)) ? parseInt(RegExp.$1) : -1
    ev = 'CPU'
  }
  else if (/SOUND/.test(ev))
    ev = 'SOUND'

  return ev
}
function parseEventToMonitorVF() {
  if (!use_2nd_monitor)
    return ""

  var ev = Settings.EventToMonitorVF
  if (/CPU/.test(ev)) {
    EventToMonitor_para2 = (/(\d+)/.test(ev)) ? parseInt(RegExp.$1) : -1
    ev = 'CPU'
  }
  else if (/SOUND/.test(ev))
    ev = 'SOUND'

  return ev
}

var Sound_EQBand_mod = 0.7
var Sound_Spectrum, Sound_classRoot
var Sound_SpectrumVF, Sound_classRootVF
Sound_Spectrum = {
  SOUND_ALL: {
    EQ_ini:0,
    EQ_end:15,
    EQ_divider:16*1
  },

  SOUND_LOW: {
    EQ_ini:0,
    EQ_end:3,
    EQ_divider:2+4+3+1,
    EQ_factor:[2,4,3,1]
  },

  SOUND_MID: {
    EQ_ini:4,
    EQ_end:11,
    EQ_divider:1+2+3+4+4+3+2+1,
    EQ_factor:[1,2,3,4,4,3,2,1]
  },

  SOUND_HIGH: {
    EQ_ini:12,
    EQ_end:15,
    EQ_divider:1+3+4+2,
    EQ_factor:[1,3,4,2]
  }
}
Sound_SpectrumVF = Sound_Spectrum

var Random_u
var Random_u_last = -1
var Random_uVF
var Random_u_lastVF = -1

function loadMain() {
  Settings.EventToMonitor = System.Gadget.Settings.readString("EventToMonitor")
  if (!Settings.EventToMonitor)
    Settings.EventToMonitor = Settings_default.EventToMonitor

  Settings.EventToMonitorVF = System.Gadget.Settings.readString("EventToMonitorVF")
  if (!Settings.EventToMonitorVF)
    Settings.EventToMonitorVF = Settings_default.EventToMonitorVF

  Settings.MonitorSensitivity = System.Gadget.Settings.readString("MonitorSensitivity")
  if (!Settings.MonitorSensitivity)
    Settings.MonitorSensitivity = Settings_default.MonitorSensitivity

  Settings.Monitor2Sensitivity = System.Gadget.Settings.readString("Monitor2Sensitivity")
  if (!Settings.Monitor2Sensitivity)
    Settings.Monitor2Sensitivity = Settings_default.Monitor2Sensitivity

  Settings.UpdateInterval = System.Gadget.Settings.readString("UpdateInterval")
  if (!Settings.UpdateInterval)
    Settings.UpdateInterval = Settings_default.UpdateInterval

  Settings.Display = System.Gadget.Settings.readString("Display")
  if (!Settings.Display)
    Settings.Display = Settings_default.Display

  Settings.ReverseAnimation = returnBoolean("ReverseAnimation")
  Settings.UseMarkers = returnBoolean("UseMarkers")
  Settings.UseImgCache = use_gallery_img_cache = returnBoolean("UseImgCache")

  Settings.MonitorSensitivity = parseFloat(Settings.MonitorSensitivity)
  Settings.Monitor2Sensitivity = parseFloat(Settings.Monitor2Sensitivity)
  Settings.UpdateInterval = PC_count_max = parseInt(Settings.UpdateInterval)
  Settings.Display = parseInt(Settings.Display)

// obsolete
/*
  Settings.HandleOversize = System.Gadget.Settings.readString("HandleOversize")
  if (!Settings.HandleOversize)
    Settings.HandleOversize = Settings_default.HandleOversize
*/

// main
  var t = ''

  if (MacFace_mode && Settings.UseMarkers) {
     WMI_ev_obj_pages = new WMI_Refresher("Win32_PerfFormattedData_PerfOS_Memory", "EV")
     WMI_ev_obj_pages.init()
  }

  switch (parseEventToMonitor()) {
case "CPU":
  t = 'CPU usage (' + ((EventToMonitor_para1 > -1) ? 'core ' + (EventToMonitor_para1+1) : 'general') + ')'
  break

case "RAM":
  t = 'RAM usage'
  break

case "HDD":
case "HDD_ALL":
try {
  WMI_ev_obj = new WMI_Refresher("Win32_PerfFormattedData_PerfDisk_LogicalDisk", "EV")
  WMI_ev_obj.init()
}
catch (ex) {}

  if (Settings.EventToMonitor == "HDD") {
    drive_letter_default = drive_letter_system = System.Environment.getEnvironmentVariable("SystemRoot").charAt(0).toUpperCase()
    t = 'Drive activity (' + drive_letter_default + ':)'
  }
  else
    t = 'Drive activity (all drives total)'
  break

case "NET":
try {
  WMI_ev_obj = new WMI_Refresher("Win32_PerfFormattedData_Tcpip_NetworkInterface", "EV")
  WMI_ev_obj.init()
}
catch (ex) {}

  OBJ = {
    download_peak:1,
    upload_peak:1
  }
  t = 'Network usage (primary adapter)'
  break

case "SOUND":
try {
  oShell = new ActiveXObject("WScript.Shell");
}
catch (ex) {}
  if (self.use_full_spectrum)
    EV_usage_sub = EV_usage_sub_CREATE(null, "sound", 3)

  t = "Sound output ("
  switch (Settings.EventToMonitor) {
case "SOUND_ALL":
  t += "all frequencies"
  break
case "SOUND_LOW":
  t += "bass"
  break
case "SOUND_MID":
  t += "mid-tones"
  break
case "SOUND_HIGH":
  t += "treble"
  break
  }

  t += ")"
  break

case "BATTERY_CHARGE":
  t = 'Battery Charge'
  break

case "BATTERY_REMAINING":
  t = 'Battery Charge Remaining'
  break

case "BATTERY_STATE":
  t = 'Battery State'
  break

case "BATTERY_STATE_CHARGE":
  t = 'Battery State and Charge level'
  break

case "BATTERY_STATE_REMAINING":
  t = 'Battery State and Charge remaining'
  break

case "TIMER_60_SECONDS":
  t = 'Timer (60 seconds)'
  break

case "TIMER_60_MINUTES":
  t = 'Timer (60 minutes)'
  break

case "TIMER_24_HOURS":
  t = 'Timer (24 hours)'
  break

case "FIXED_VALUE_50":
  t = 'Fixed value (50%)'
  break

case "FIXED_VALUE_100":
  t = 'Fixed value (100%)'
  break

case "RANDOM_VALUE":
  t = 'Random value (0-100%)'
  break
  }

   switch (parseEventToMonitorVF()) {
case "CPU":
   break

case "RAM":
   break

case "HDD":
case "HDD_ALL":
try {
  if (/HDD/.test(parseEventToMonitor()))
    WMI_ev_objVF = WMI_ev_obj
  else {
    WMI_ev_objVF = new WMI_Refresher("Win32_PerfFormattedData_PerfDisk_LogicalDisk", "EV")
    WMI_ev_objVF.init()
  }
}
catch (ex) {}

  if (Settings.EventToMonitorVF == "HDD") {
    drive_letter_defaultVF = drive_letter_systemVF = System.Environment.getEnvironmentVariable("SystemRoot").charAt(0).toUpperCase()
  }
  break

case "NET":
try {
  if (parseEventToMonitor() == "NET")
    WMI_ev_objVF = WMI_ev_obj
  else {
    WMI_ev_objVF = new WMI_Refresher("Win32_PerfFormattedData_Tcpip_NetworkInterface", "EV")
    WMI_ev_objVF.init()
  }
}
catch (ex) {}

  OBJVF = {
    download_peak:1,
    upload_peak:1
  }
  break

case "SOUND":
  if (parseEventToMonitor() == "SOUND")
    oShellVF = oShell
  else {

try {
  oShellVF = new ActiveXObject("WScript.Shell");
}
catch (ex) {}

  }

  if (self.use_full_spectrum)
    EV_usage_subVF = EV_usage_sub_CREATE(null, "sound", 3)
  break

case "TIMER_60_SECONDS":
  break

case "TIMER_60_MINUTES":
  break

case "TIMER_24_HOURS":
  break

case "FIXED_VALUE_50":
  break

case "FIXED_VALUE_100":
  break

case "RANDOM_VALUE":
  break
  }


  document.body.title = t

  EV_usage = EV_usage_float = EV_usage_last = EV_usage_last_float = -1

  PC_count = 1
  PC_count_absolute = 0

// main
  if (SEQ_mode && (SEQ_gallery_all.length == 1) && (!SEQ_gallery_all[0].ss_path_list || (SEQ_gallery_all[0].ss_path_list.length == 1))) {
    if (gallery_cache_obj.SS_mode)
      SEQ_gallery_all[0].gallery = gallery

    gallery_cache_obj.SS_mode = false
  }

  if (w_max && h_max) {
    gallery_dim_predefined = true

    gallery_preload_always = !!System.Gadget.Settings.readString("PreloadGalleryAlways")
    if (gallery_preload_always)
      loadImageDimALL()
    else {
      if (SEQ_mode && !gallery_cache_obj.SS_mode) {
        Seq.item("SEQ_SmartPreloading").At(0.25, "SEQ_SmartPreloading", -1, 0.25)
        Seq.item("SEQ_SmartPreloading").Play()
      }
    }
  }
  else
    loadImageDimALL()

  resize()
}

var EV_frame_offsetX, EV_frame_offsetY
var w_max_org, h_max_org
var SA_zoom = 1
var SA_zoom_max = 2
var SA_zoom_filterType = "nearest"

function resize() {
// Native IMG START
if (use_native_img) {
  if (!w_max_org)
    w_max_org = w_max
  if (!h_max_org)
    h_max_org = h_max

  image_ratio = (System.Gadget.docked) ? 0.5 : 1

  BG.removeObjects()

  gallery_cache_obj.use_native_img = true
  gallery_cache_obj.clear()
  pic_last = null

  for (var i = 0; i < native_img_objs.length; i++)
    native_img_objs[i].clear()
}
// END

  if (self.EV_init)
    EV_init()
  if (self.EV_init2)
    EV_init2()

if (use_native_img) {
  w_max = w_max_org * image_ratio
  h_max = h_max_org * image_ratio
}

  if (!EV_frame_offsetX)
    EV_frame_offsetX = 0
  if (!EV_frame_offsetY)
    EV_frame_offsetY = 0

  var oBody = document.body.style

  var w_base, h_base
  if (System.Gadget.docked) {
    w_base = (w_max > 130) ? ((w_max < 140) ? w_max : 140) : 130
    h_base = 260
  }
  else {
    w_base = (w_max > 130) ? w_max : 130
    h_base = 999
  }

  b_width = (self.EV_b_width) ? EV_b_width : w_base
  b_height = (self.EV_b_height) ? EV_b_height : ((h_max > h_base) ? h_base : h_max)

  B_width = (self.EV_width) ? EV_width : b_width
  if (B_width < w_base)
    B_width = w_base
  B_height = (self.EV_height) ? EV_height : b_height

  if (self.EV_BG_src) {
    BG.src = EV_BG_src
//setTimeout('DEBUG_show("(BG: user defined)", 2)', 1000)
  }
  else {
    var bg_w, bg_h, bg_src
    if (self.EV_BG_src == "") {
      bg_w = BG.style.pixelWidth
      bg_h = BG.style.pixelHeight
    }
    else {
      bg_w = B_width * SA_zoom
      bg_h = B_height * SA_zoom
    }

// IE9 fix
if (ie9) {
  if (bg_w < 130)
    bg_w = 130
}

    if (self.EV_BG_allow_dummy || (!MacFace_mode && !use_native_img && (!self.EV_init || (!self.EV_width && !self.EV_height)))) {
// IE9 fix
if (!ie9)
  bg_w = bg_h = 1

      bg_src = "images/_bg_dummy/1x1.png"
//DEBUG_show("(BG: OFF)", 2)
    }
    else {
      bg_src = "images/bg.png"
//setTimeout('DEBUG_show("(BG: default)", 2)', 1000)
    }

    BG.style.pixelWidth  = bg_w
    BG.style.pixelHeight = bg_h

    BG.src = bg_src

    // Windows 7's savior
    BG.opacity = 0
  }

// bar

  var cs = LCPU_main.style
  if (Settings.Display > 0) {
    var color = bar_color[Settings.Display]
    LCPU_main_up.style.backgroundColor = color[0]
    LCPU_main_down.style.backgroundColor = color[1]

    if (ie8_mode) {
      LCPU_main_up.style.pixelHeight = LCPU_main_down.style.pixelHeight = LCPU_main_down.style.posTop = 4
      LCPU_main_content.style.pixelHeight = 8
    }

    cs.posTop = B_height * SA_zoom
    cs.pixelWidth = (B_width - ((ie8_mode)?2:0)) * SA_zoom
    cs.visibility = "inherit"
  }
  else
    cs.visibility = "hidden"

  cs = Lmain_obj.style
  cs.pixelWidth = B_width * SA_zoom - (cs.posLeft * 2)
  cs.pixelHeight = B_height * SA_zoom - (cs.posTop * 2)
  cs.filter = (SA_zoom == 1) ? "" : "progid:DXImageTransform.Microsoft.Matrix(M11=" + SA_zoom + ", M22=" + SA_zoom + ", FilterType='" + SA_zoom_filterType + "')"

  oBody.pixelWidth = B_width * SA_zoom
  oBody.pixelHeight = B_height * SA_zoom + ((Settings.Display > 0) ? 8+((ie8_mode)?2:0) : 0)


  if (!image_ratio)
    image_ratio = 1

  setTimeout('self.focus()', 300)
}

function CheckDockState() {
//  System.Gadget.beginTransition();
  resize()
//  System.Gadget.endTransition(1, 2);
}

var EV_usage, EV_usage_float, EV_usage_last, EV_usage_last_float

var PC_count_max = 10
var PC_count = 1

var bar_accelerate
bar_accelerate=true

function barPhysics(s) {
  if (PC_count_max == 1)
    return s

  var t = (PC_count_max - PC_count) / PC_count_max
  if (!bar_accelerate)
    return s*t

  var u = s*2
  var a = -u
  var s_final = u*t + 0.5*a*t*t

  return s_final
}

function Animate() {
  PC_count_absolute++

  var update_all
  if (--PC_count <= 0) {
    PC_count = PC_count_max
    update_all = true

    updateEvent()
  }

  if (self.EV_animate_full)
    EV_animate_full()

  var u = EV_usage
  var u_last = (EV_usage_last < 0) ? 0 : EV_usage_last
  if (Settings.ReverseAnimation) {
    u = 100 - u
    u_last = 100 - u_last
  }

  if (update_all || (u != u_last)) {
    var mod = barPhysics(u - u_last) + u_last
    LCPU_main_content.style.pixelWidth = parseInt(mod * (B_width*SA_zoom-2) / 100)
  }
}

var EQ_Emu = {
   bands_norm:[]
  ,bands:[]
  ,shuffle_count: 0
  ,v:-1
  ,v_last:-1

  ,update: function (v) {
if (v == null)
  v = EV_usage_float

this.v_last = this.v
this.v = v

if ((--this.shuffle_count <= 0) || (this.v_last < 1)) {
  var min = 40 * v/100
  var max = 80 * v/100
  for (var i = 0; i < 16; i++)
    this.bands_norm[i] = Math.random() * (max-min) + min

  this.shuffle_count = (random(10) + 10) * 10/PC_count_max
}
else {
  for (var i = 0; i < 16; i++)
    this.bands_norm[i] *= v / this.v_last
}

var range = 40 * v/100
if (range > 25)
  range = 25
for (var i = 0; i < 16; i++) {
  var b = this.bands_norm[i] + Math.random() * (range*2) - range
  if (b > 100)
    b = 100

  this.bands[i] = b
}

return this.bands
  }
}


var OBJ
var OBJVF

var oShell
var oShellVF
var regRoot = ["HKLM", "HKCU"]
var axDllClass = (Vista_or_above) ? "WASAPIlib.WASAPImain" : "EQGadget.EQ";

var EV_usage_sub
var EV_usage_subVF


function EV_usage_sub_CREATE(uu, obj_name, length) {
  if (!uu)
    uu = {}

  uu[obj_name] = []

  for (var i = 0; i < length; i++) {
    var obj = {
 usage:0
,EV_usage:-1
,EV_usage_float:-1
,EV_usage_last:-1
,EV_usage_last_float:-1

//misc
,filter_u_last:0
    };

    uu[obj_name][i] = obj
  }

  return uu
}

function EV_usage_PROCESS(obj, usage) {
  if (usage < 0)
    usage = 0
  else if (usage > 100)
    usage = 100

  usage = Math.pow(usage/100, ((!obj && use_2nd_monitor) ? Settings.Monitor2Sensitivity : Settings.MonitorSensitivity)) * 100

  if (Settings.ReverseAnimation)
    usage = 100 - usage

  if (obj) {
    obj.EV_usage_last_float = obj.EV_usage_float
    obj.EV_usage_last = obj.EV_usage

    obj.EV_usage_float = usage
    obj.EV_usage = usage = parseInt(usage)
  }
  return usage
}

function updateEvent() {
  var usage = 0
  var usagevf = 0
  var usage_pagein = 0
  var usage_pageout = 0
// New variables for battery usage
  var usage_markermode = 0
  var usage_onbattery = 0
  var usage_batterycharging = 0


  switch (parseEventToMonitor()) {
case "CPU":
  var max = System.Machine.CPUs.count

  var CPU_core = []
  for (var i = 0; i < max; i++) {
    var u = System.Machine.CPUs.item(i).usagePercentage + 1
    CPU_core[i] = u
    usage += u
  }

  usage = (CPU_core[EventToMonitor_para1]) ? CPU_core[EventToMonitor_para1] : usage/max
  usage -= 1

// To prevent the animation from looking choppy when the usage is low and the meter sensitivity is set to "high/very high"
  if (usage <= 0.1)
    usage = 0.1
  break

case "RAM":
  usage = (1 - System.Machine.availableMemory / System.Machine.totalMemory) * 100
  break

case "HDD":

try {
  WMI_ev_obj.update()

  var dd = WMI_ev_obj.collection
  for (var d = 0; d < dd.length; d++) {
    var drive = dd[d]
    var l = drive.Name.charAt(0).toUpperCase()
    if (l != drive_letter_default)
      continue

    usage = parseInt(drive.PercentDiskTime)
    break
  }
}
catch (ex) {}
  break

case "HDD_ALL":

try {
  WMI_ev_obj.update()

  var dd = WMI_ev_obj.collection
  var drive = dd[dd.length - 1]
  usage = parseInt(drive.PercentDiskTime)
}
catch (ex) {}
  break

case "NET":

try {
  var o = WMI_ev_obj.update()[0]
  var dl = parseInt(o.BytesReceivedPerSec);
  var ul = parseInt(o.BytesSentPerSec);
  var dl_ul = dl + ul

  if (OBJ.download_peak < dl)
    OBJ.download_peak = dl
  if (OBJ.upload_peak < ul)
    OBJ.upload_peak = ul

  var dl_ratio = dl / OBJ.download_peak
  var ul_ratio = ul / OBJ.upload_peak

  if (dl_ul)
    usage = (dl_ratio * (dl / dl_ul) + ul_ratio * (ul / dl_ul)) * 100
}
catch (ex) {}
  break

case "SOUND":
  if (!oShell)
    break

  var EQBand
  if (Sound_classRoot) {
    try { EQBand = oShell.RegRead(Sound_classRoot + "EQBand\\"); } catch (ex) {}
  }
  else {
    for (var i = 0; i < regRoot.length; i++) {
      var classRoot = regRoot[i] + "\\Software\\Classes\\" + axDllClass + "\\";

      EQBand = ""
      try { EQBand = oShell.RegRead(classRoot + "EQBand\\"); } catch (ex) {}

      if (EQBand) {
        Sound_classRoot = classRoot
        break
      }
    }
  }
  if (!EQBand) {
    Sound_classRoot = ""
    break
  }

  EQBand = eval(EQBand)

  var spectrum = Sound_Spectrum[Settings.EventToMonitor]

  var EQ_total = 0
  for (var i = spectrum.EQ_ini; i <= spectrum.EQ_end; i++)
    EQ_total += EQBand[i] * ((spectrum.EQ_factor) ? spectrum.EQ_factor[i - spectrum.EQ_ini] : 1)

  EQ_total /= spectrum.EQ_divider

  usage = EQ_total

//EV_usage_sub=null
if (EV_usage_sub) {
  var ss_type = ['SOUND_LOW', 'SOUND_MID', 'SOUND_HIGH']
  for (var k = 0; k < 3; k++) {
    var ss = ss_type[k]
    var obj = EV_usage_sub.sound[k]
    if (ss == Settings.EventToMonitor) {
      obj.usage = usage
      continue
    }

    var spectrum = Sound_Spectrum[ss]

    var EQ_total = 0
    for (var i = spectrum.EQ_ini; i <= spectrum.EQ_end; i++)
      EQ_total += EQBand[i] * ((spectrum.EQ_factor) ? spectrum.EQ_factor[i - spectrum.EQ_ini] : 1)

    EQ_total /= spectrum.EQ_divider

    obj.usage = EQ_total
  }

  if (!EV_usage_sub.sound_raw)
    EV_usage_sub_CREATE(EV_usage_sub, "sound_raw", EQBand.length)

  for (var i = 0; i < EQBand.length; i++)
    EV_usage_sub.sound_raw[i].usage_raw = EQBand[i]
}
  break

case "BATTERY_CHARGE":
  usage_markermode = 1
  usage = System.Machine.PowerStatus.batteryPercentRemaining
  break

case "BATTERY_REMAINING":
  usage_markermode = 1
  usage = 100 - System.Machine.PowerStatus.batteryPercentRemaining
  break

case "BATTERY_STATE":
  usage_markermode = 1
  if (System.Machine.PowerStatus.isPowerLineConnected) {
	if (System.Machine.PowerStatus.isBatteryCharging)
		usage = 50
	else
		usage = 0
  }
  else
	usage = 100
  break

case "BATTERY_STATE_CHARGE":
  usage_markermode = 1
  if (System.Machine.PowerStatus.isPowerLineConnected)
	usage = 100
  else
  	usage = System.Machine.PowerStatus.batteryPercentRemaining
  break

case "BATTERY_STATE_REMAINING":
  usage_markermode = 1
  if (System.Machine.PowerStatus.isPowerLineConnected)
  	usage = 0
  else
  	usage = 100 - System.Machine.PowerStatus.batteryPercentRemaining
  break

case "TIMER_60_SECONDS":
  var time = new Date()
  var seconds = time.getSeconds()
  usage = seconds/60 * 100
  break

case "TIMER_60_MINUTES":
  var time = new Date()
  var minutes = time.getMinutes()
  var seconds = time.getSeconds()
  usage = (minutes + seconds/60)/60 * 100
  break

case "TIMER_24_HOURS":
  var time = new Date()
  var hours = time.getHours()
  var minutes = time.getMinutes()
  usage = (hours + minutes/60)/24 * 100
  break

case "FIXED_VALUE_50":
  usage = 50
  break

case "FIXED_VALUE_100":
  usage = 100
  break

case "RANDOM_VALUE":
  usage = Random_u = ((Random_u_last == -1) || (PC_count_absolute % 20 == 1)) ? random(101) : Random_u

  if (Random_u_last == -1)
    Random_u_last = 0

  var inc = 100 * (PC_count_max * 1) / 10
  if (usage > Random_u_last) {
    if (usage > Random_u_last + inc)
      usage = Random_u_last + inc
  }
  else {
    if (usage < Random_u_last - inc)
      usage = Random_u_last - inc
  }
  Random_u_last = usage
  break

  }


  switch (parseEventToMonitorVF()) {
case "CPU":
  var max = System.Machine.CPUs.count

  var CPU_core = []
  for (var i = 0; i < max; i++) {
    var u = System.Machine.CPUs.item(i).usagePercentage + 1
    CPU_core[i] = u
    usagevf += u
  }

  usagevf = (CPU_core[EventToMonitor_para2]) ? CPU_core[EventToMonitor_para2] : usagevf/max
  usagevf -= 1

// To prevent the animation from looking choppy when the usagevf is low and the meter sensitivity is set to "high/very high"
  if (usagevf <= 0.1)
    usagevf = 0.1
  break

case "RAM":
  usagevf = 1 - (System.Machine.availableMemory / System.Machine.totalMemory) * 100
  break

case "HDD":

try {
  WMI_ev_objVF.update()

  var dd = WMI_ev_objVF.collection
  for (var d = 0; d < dd.length; d++) {
    var drive = dd[d]
    var l = drive.Name.charAt(0).toUpperCase()
    if (l != drive_letter_defaultVF)
      continue

    usagevf = parseInt(drive.PercentDiskTime)
    break
  }
}
catch (ex) {}
  break

case "HDD_ALL":

try {
  WMI_ev_objVF.update()

  var dd = WMI_ev_objVF.collection
  var drive = dd[dd.length - 1]
  usagevf = parseInt(drive.PercentDiskTime)
}
catch (ex) {}
  break

case "NET":

try {
  var o = WMI_ev_objVF.update()[0]
  var dl = parseInt(o.BytesReceivedPerSec);
  var ul = parseInt(o.BytesSentPerSec);
  var dl_ul = dl + ul

  if (OBJVF.download_peak < dl)
    OBJVF.download_peak = dl
  if (OBJVF.upload_peak < ul)
    OBJVF.upload_peak = ul

  var dl_ratio = dl / OBJVF.download_peak
  var ul_ratio = ul / OBJVF.upload_peak

  if (dl_ul)
    usagevf = (dl_ratio * (dl / dl_ul) + ul_ratio * (ul / dl_ul)) * 100
}
catch (ex) {}
  break

case "SOUND":
  if (!oShellVF)
    break

  var EQBand
  if (Sound_classRootVF) {
    try { EQBand = oShellVF.RegRead(Sound_classRootVF + "EQBand\\"); } catch (ex) {}
  }
  else {
    for (var i = 0; i < regRoot.length; i++) {
      var classRoot = regRoot[i] + "\\Software\\Classes\\" + axDllClass + "\\";

      EQBand = ""
      try { EQBand = oShellVF.RegRead(classRoot + "EQBand\\"); } catch (ex) {}

      if (EQBand) {
        Sound_classRootVF = classRoot
        break
      }
    }
  }
  if (!EQBand) {
    Sound_classRootVF = ""
    break
  }

  EQBand = eval(EQBand)

  var spectrum = Sound_SpectrumVF[Settings.EventToMonitorVF]

  var EQ_total = 0
  for (var i = spectrum.EQ_ini; i <= spectrum.EQ_end; i++)
    EQ_total += EQBand[i] * ((spectrum.EQ_factor) ? spectrum.EQ_factor[i - spectrum.EQ_ini] : 1)

  EQ_total /= spectrum.EQ_divider

  usagevf = EQ_total

//EV_usage_sub=null
if (EV_usage_subVF) {
  var ss_type = ['SOUND_LOW', 'SOUND_MID', 'SOUND_HIGH']
  for (var k = 0; k < 3; k++) {
    var ss = ss_type[k]
    var obj = EV_usage_subVF.sound[k]
    if (ss == Settings.EventToMonitorVF) {
      obj.usage = usagevf
      continue
    }

    var spectrum = Sound_SpectrumVF[ss]

    var EQ_total = 0
    for (var i = spectrum.EQ_ini; i <= spectrum.EQ_end; i++)
      EQ_total += EQBand[i] * ((spectrum.EQ_factor) ? spectrum.EQ_factor[i - spectrum.EQ_ini] : 1)

    EQ_total /= spectrum.EQ_divider

    obj.usage = EQ_total
  }

  if (!EV_usage_subVF.sound_raw)
    EV_usage_sub_CREATE(EV_usage_subVF, "sound_raw", EQBand.length)

  for (var i = 0; i < EQBand.length; i++)
    EV_usage_subVF.sound_raw[i].usage_raw = EQBand[i]
}
  break

case "BATTERY_CHARGE":
  usagevf = System.Machine.PowerStatus.batteryPercentRemaining
  break

case "BATTERY_REMAINING":
  usagevf = 100 - System.Machine.PowerStatus.batteryPercentRemaining
  break

case "BATTERY_STATE":
  if (System.Machine.PowerStatus.isPowerLineConnected) {
	if (System.Machine.PowerStatus.isBatteryCharging)
		usagevf = 50
	else
		usagevf = 0
  }
  else
	usagevf = 100
  break

case "BATTERY_STATE_CHARGE":
  if (System.Machine.PowerStatus.isPowerLineConnected)
	usagevf = 100
  else
  	usagevf = batteryPercentRemaining
  break

case "BATTERY_STATE_REMAINING":
  if (System.Machine.PowerStatus.isPowerLineConnected)
	usagevf = 0
  else
  	usagevf = 100 - System.Machine.PowerStatus.batteryPercentRemaining
  BREAK

case "TIMER_60_SECONDS":
  var time = new Date()
  var seconds = time.getSeconds()
  usagevf = seconds/60 * 100
  break

case "TIMER_60_MINUTES":
  var time = new Date()
  var minutes = time.getMinutes()
  var seconds = time.getSeconds()
  usagevf = (minutes + seconds/60)/60 * 100
  break

case "TIMER_24_HOURS":
  var time = new Date()
  var hours = time.getHours()
  var minutes = time.getMinutes()
  usagevf = (hours + minutes/60)/24 * 100
  break

case "FIXED_VALUE_50":
  usagevf = 50
  break

case "FIXED_VALUE_100":
  usagevf = 100
  break

case "RANDOM_VALUE":
  usagevf = Random_uVF = ((Random_u_lastVF == -1) || (PC_count_absolute % 20 == 1)) ? random(101) : Random_uVF

  if (Random_u_lastVF == -1)
    Random_u_lastVF = 0

  var inc = 100 * (PC_count_max * 1) / 10
  if (usagevf > Random_u_lastVF) {
    if (usagevf > Random_u_lastVF + inc)
      usagevf = Random_u_lastVF + inc
  }
  else {
    if (usagevf < Random_u_lastVF - inc)
      usagevf = Random_u_lastVF - inc
  }
  Random_u_lastVF = usagevf
  break

  }


// Moved here and changed the behaviour to allow for using markers with battery.
// If Primary Monitor is a Battery Monitor, markers will indicate charging and power loss events 

  if (MacFace_mode && Settings.UseMarkers) {
     if (usage_markermode == 1) {
        if (!System.Machine.PowerStatus.isPowerLineConnected)
          usage_pagein = 1 
        if (System.Machine.PowerStatus.isBatteryCharging)
          usage_pageout = 1
     }
     else {
       try {
          var p = WMI_ev_obj_pages.update()[0]
          usage_pagein = parseInt(p.PagesInputPerSec)
          usage_pageout = parseInt(p.PagesOutputPerSec)
          //usage_pagein = parseInt(p.PagesReadPerSec)
          //usage_pageout = parseInt(p.PagesWritePerSec)
       }
       catch (ex) {}
     }
  }


// main

  usage = EV_usage_PROCESS(self, usage)
  usagevf = EV_usage_PROCESS(null, usagevf)

  if (EV_usage_sub) {

// Emulate the sound EQ object for non-sound activity - START
if (parseEventToMonitor() != "SOUND") {

  var EQBand = []
if (parseEventToMonitor() == "RANDOM_VALUE") {
//DEBUG_show(EV_usage_float)
  EQBand = EQ_Emu.update()
}
else {
  var min = (self.EQP_EQ_min != null) ? EQP_EQ_min : 0
  var max = (self.EQP_EQ_max != null) ? EQP_EQ_max : 15

  var EQ_u = usage
  // Restore the animation order
  if (Settings.ReverseAnimation)
    EQ_u = 100 - EQ_u
  EQ_u *= (max - min + 1)

  for (var i = 0; i < 16; i++) {
    if ((i < min) || (i > max))
      EQBand[i] = usage
    else {
      var u = EQ_u
      if (u > 100)
        u = 100
      else if (u < 0)
        u = 0
      EQBand[i] = u
      EQ_u -= 100
    }
  }
}

  var ss_type = ['SOUND_LOW', 'SOUND_MID', 'SOUND_HIGH']
  for (var k = 0; k < 3; k++) {
    var ss = ss_type[k]
    var obj = EV_usage_sub.sound[k]

    var spectrum = Sound_Spectrum[ss]

    var EQ_total = 0
    for (var i = spectrum.EQ_ini; i <= spectrum.EQ_end; i++)
      EQ_total += EQBand[i] * ((spectrum.EQ_factor) ? spectrum.EQ_factor[i - spectrum.EQ_ini] : 1)

    EQ_total /= spectrum.EQ_divider

    obj.usage = EQ_total
  }

  if (!EV_usage_sub.sound_raw)
    EV_usage_sub_CREATE(EV_usage_sub, "sound_raw", EQBand.length)

  for (var i = 0; i < EQBand.length; i++)
    EV_usage_sub.sound_raw[i].usage_raw = EQBand[i] / Sound_EQBand_mod
}
// END

    for (var i = 0; i < EV_usage_sub.sound.length; i++) {
      var obj = EV_usage_sub.sound[i]
      EV_usage_PROCESS(obj, obj.usage)
    }
    if (EV_usage_sub.sound_raw) {
      for (var i = 0; i < EV_usage_sub.sound_raw.length; i++) {
        var obj = EV_usage_sub.sound_raw[i]
        EV_usage_PROCESS(obj, obj.usage_raw)
      }
    }
  }
  if (EV_usage_subVF) {
    for (var i = 0; i < EV_usage_subVF.sound.length; i++) {
      var obj = EV_usage_subVF.sound[i]
      EV_usage_PROCESS(obj, obj.usage)
    }
    if (EV_usage_subVF.sound_raw) {
      for (var i = 0; i < EV_usage_subVF.sound_raw.length; i++) {
        var obj = EV_usage_subVF.sound_raw[i]
        EV_usage_PROCESS(obj, obj.usage_raw)
      }
    }
  }


  if (MacFace_mode) {
    var usemarker1 = false
    var usemarker2 = false

    if (Settings.UseMarkers) {
       if (usage_pagein > 0)
          usemarker1 = true
       if (usage_pageout > 0)
          usemarker2 = true
    }

    if (!parseEventToMonitorVF()) 
       usagevf = usage

    VistaFace.switchPattern(parseInt(usage/9.5),parseInt(usagevf/33.4), usemarker1, usemarker2)
  }
  else if (self.EV_adjust_timer) {
    var ms = SEQ_CalculateFPS(true)

    var ms_final = EV_AdjustTimer(ms, EV_ms_last, true)

    if (ms_final >= 0) {
      clearTimeout(EV_timerID)
      EV_timerID = setTimeout('EV_frame()', ms_final)
    }
  }

  if (!gallery.length)
    return

// Draw pic
  if (SEQ_mode) {
    var ms = SEQ_CalculateFPS() * Seq_speed_delay

    var s = Seq.item("SEQ")
    var ms_final = EV_AdjustTimer(ms, s.interval_current)

//ms_final=-1
    if (ms_final >= 0) {
      if (Seq_HT_enabled) {
        var tt = s.HT_obj
        var st = tt.currTimeState.segmentDur - ms_final/1000
        if (st >= 0)
          tt.seekSegmentTime(st)
      }
      else {
        s.Pause()
        s.timerID = setTimeout('try { clearTimeout(seq_items["SEQ"].timerID) } catch (ex) {}; seq_items["SEQ"].timerID=null; seq_items["SEQ"].Play()', ms_final)
      }
    }
    s.interval = ms

    return
  }


if (self.EV_gallery_always_1_fps) {
  if (PC_count_absolute % 10 != 1)
    return
}

  var pic
  for (var i = gallery.length-1; i >= 0; i--) {
    var obj = gallery[i]
    var f = obj.frame
    if (f >= usage)
      continue

    pic = obj
    break
  }
  if (!pic)
    pic = gallery[0]

  AnimateFrame(pic)
}

function SEQ_CalculateFPS(isEV) {
  var fps_ini, fps_end
  if (isEV) {
    fps_ini = EV_fps_ini
    fps_end = EV_fps_end
  }
  else {
    fps_ini = SEQ_fps_ini
    fps_end = Math.round(SEQ_fps_end * SEQ_fps_end_factor)
  }

  SEQ_fps = fps_ini + EV_usage_float/100 * (fps_end - fps_ini)
//  fps_ini * Math.exp(EV_usage_float/100 * Math.log(fps_end / fps_ini))

  var fps = (SEQ_fps > 30) ? 30 : SEQ_fps
  return parseInt(1000/fps)
}

var SEQ_last_update_time = 0

var SEQ_gallery_shuffled = []
var SEQ_gallery_shuffled_count = -1

function EV_AdjustTimer(ms, ms_last, isEV) {
  if (ms+16 >= ms_last)
    return -1

  var t_diff
  if (!isEV && Seq_HT_enabled)
    t_diff = parseInt(Seq.item("SEQ").HT_obj.currTimeState.segmentTime * 1000)
  else {
    var t = new Date().getTime()

    var last_update_time = (isEV) ? EV_last_update_time : SEQ_last_update_time
    t_diff = t - last_update_time
  }

  t_diff = ms - t_diff
  return ((t_diff < 0) ? 0 : t_diff)
}

var EV_first_idle_time = -1

var SEQ_gallery_shuffled_mode = true
var SEQ_gallery_shuffled = []
var SEQ_gallery_shuffled_count = -1
var SEQ_gallery_preset_order

function random_sorting(a,b) { return Math.random() - 0.5 }

function SEQ_gallery_restore_order(a,b) { return a.SEQ_index - b.SEQ_index }

function SEQ_Animate() {
  var t = new Date().getTime()
  SEQ_last_update_time = t

  if (SEQ_gallery_by_percent.length) {
    var g_index = -1

    var percent_name = null
    if (SEQ_gallery_percent_name)
      percent_name = (self.EV_return_SEQ_gallery_percent_name) ? EV_return_SEQ_gallery_percent_name() : SEQ_gallery_percent_name

    for (var i = SEQ_gallery_by_percent.length-1; i >= 0; i--) {
      var obj = SEQ_gallery_by_percent[i]

      var f = obj.index
      var is_event = isNaN(f)
      if (percent_name) {
        if (is_event) {
          if (f != percent_name)
            continue
        }
        else
          break
      }
      else if (is_event || (f >= EV_usage))
        continue

      g_index = i
      break
    }
    if (g_index == -1)
      g_index = 0

if ((PC_count_max < 5) && (SEQ_gallery_percent_index != -1)) {
  if (g_index > 0)
    EV_first_idle_time = -1
  else if ((g_index == 0) && (SEQ_gallery_percent_index != g_index)) {
    if (EV_first_idle_time == -1) {
      EV_first_idle_time = t
      g_index = SEQ_gallery_percent_index
    }
    else if (t - EV_first_idle_time < 600)
      g_index = SEQ_gallery_percent_index
  }
}

    if (SEQ_gallery_percent_index != g_index) {
      SEQ_gallery_percent_name = percent_name

      SEQ_gallery_percent_index = g_index
      SEQ_gallery = SEQ_gallery_by_percent[g_index].SEQ_gallery
      SEQ_gallery_index = -1

      SEQ_gallery_shuffled_count = -1
    }
  }

  if (SEQ_gallery_index == -1) {
    if (self.EV_on_SEQ_gallery_change)
      EV_on_SEQ_gallery_change()

    if (SEQ_gallery_shuffled_mode) {
      if (SEQ_gallery_shuffled_count == -1) {
// NOTE: Array IS modified by the sorting function.
        if (SEQ_gallery_preset_order) {
          SEQ_gallery = SEQ_gallery.sort(SEQ_gallery_restore_order)

          SEQ_gallery_shuffled = []
          for (var i = 0; i < SEQ_gallery_preset_order.length; i++)
            SEQ_gallery_shuffled.push(SEQ_gallery[SEQ_gallery_preset_order[i]])
        }
        else
          SEQ_gallery_shuffled = SEQ_gallery.sort((gallery_cache_obj.SS_mode) ? OP_gallery_sorting : random_sorting)
        SEQ_gallery_shuffled_count = 0
      }

      SEQ_gallery_index = SEQ_gallery_shuffled[SEQ_gallery_shuffled_count].SEQ_index

      if (gallery_cache_obj.SS_mode) {
        gallery_cache_obj.SS_path_list_lvl = gallery_cache_obj.SS_path_list_index = 0
        gallery_cache_obj.SS_path_list[0] = SEQ_gallery_all[SEQ_gallery_index].ss_path_list
      }

      var SS_index = -1
      if (++SEQ_gallery_shuffled_count >= SEQ_gallery.length) {
        SEQ_gallery_shuffled_count = -1

        if (gallery_cache_obj.SS_mode)
          SS_index = OP_SEQ_index = Math.floor(Math.random() * SEQ_gallery.length)
      }
      else if (gallery_cache_obj.SS_mode)
        SS_index = SEQ_gallery_shuffled[SEQ_gallery_shuffled_count].SEQ_index

      if (SS_index != -1) {
        if (gallery_cache_obj.SS_path_list[0].length == 1) {
          gallery_cache_obj.SS_path_list_lvl = 1
          gallery_cache_obj.SS_path_list_index = -1
        }
        else {
          gallery_cache_obj.SS_path_list_lvl = 0
          gallery_cache_obj.SS_path_list_index = 0
        }

        gallery_cache_obj.SS_path_list[1] = SEQ_gallery_all[SS_index].ss_path_list
      }
    }
    else
      SEQ_gallery_index = Math.floor(Math.random() * SEQ_gallery.length)

    if (self.EV_on_after_SEQ_gallery_change)
      EV_on_after_SEQ_gallery_change()

    var gallery_obj = SEQ_gallery_all[SEQ_gallery_index]
    gallery = (gallery_obj.gallery) ? gallery_obj.gallery : SEQ_generate_gallery(gallery_obj)
    gallery_obj.count = 0

if (gallery_obj.loop_absolute)
  gallery_obj.loop = gallery_obj.loop_absolute
else {
  var loop_f = gallery.length
  if (loop_f < 10)
    loop_f = 10
  else if (loop_f > 30)
    loop_f = 30
  var loop = Math.round(loop_f * 5 * gallery_obj.loop_factor / gallery.length)
  if (!loop)
    loop = 1

  gallery_obj.loop = loop + ((gallery.length > 350) ? 0 : Math.floor(Math.random() * (loop+1)))
}

    SEQ_fps_ini = gallery_obj.SEQ_fps_ini
    SEQ_fps_end = gallery_obj.SEQ_fps_end
    if (SEQ_mode)
      Seq.item("SEQ").interval = SEQ_CalculateFPS()

    if (SEQ_ani_count_overridden) {
      SEQ_ani_count = SEQ_ani_count_overridden
      SEQ_ani_count_overridden = null
    }
    else
      SEQ_ani_count = 0

    if (self.EV_SEQ_refresh)
      EV_SEQ_refresh()
  }

  var pic = gallery[SEQ_ani_count]

  if (++SEQ_ani_count >= gallery.length) {
    SEQ_ani_count = 0

    var gallery_obj = SEQ_gallery_all[SEQ_gallery_index]
    if (++gallery_obj.count >= gallery_obj.loop) {
      SEQ_gallery_index = -1

      if (gallery_obj.onfinish)
        gallery_obj.onfinish()
    }
  }

// handle frame skipping
  if (SEQ_fps_frame_skip_mod >= 1) {
    SEQ_fps_frame_skip_mod -= 1
    SEQ_Animate()
    return
  }

  AnimateFrame(pic)

  if (SEQ_fps > 30)
    SEQ_fps_frame_skip_mod += (SEQ_fps - 30) / 30
}

var Gallery_h_align = "center"
var Gallery_v_align = "bottom"

function AnimateFrame(pic) {
  if (!pic.w && !pic.h) {
    var dim = loadImageDim(pic.path)
    pic.w = dim.w
    pic.h = dim.h
  }
  var w = pic.w
  var h = pic.h

  if (self.EV_AnimateFrame) {
    var obj = EV_AnimateFrame(pic, w,h)
    if (!obj)
      return

    pic = obj.pic
    w = obj.w
    h = obj.h
  }

  var ds = Lmain_animation.style
  ds.posLeft = EV_frame_offsetX
  ds.posTop = EV_frame_offsetY
  ds.pixelWidth = b_width
  ds.pixelHeight = b_height

  if (pic_last == pic)
    return
  pic_last = pic

  var path
  if (use_GIMAGE) {
    if (!pic.path_GIMAGE)
      pic.path_GIMAGE = "gimage:///" + pic.path + ("?width=" + w + "&height=" + h)
    path = pic.path_GIMAGE
  }
  else
    path = pic.path_file

  if (gallery_cache_obj.SS_mode && (gallery_cache_obj.SS_path != path)) {
    gallery_cache_obj.SS_path = path

    setTimeout('gallery_cache_obj.SS_preload()', 0)
//DEBUG_show('Preload => ' + SEQ_gallery_index + '/' + gallery_cache_obj.SS_path_list_lvl + ',' + gallery_cache_obj.SS_path_list_index)
  }

  if (!gallery_cache_obj.load(path)) {
    w *= image_ratio
    h *= image_ratio

    ds = img_obj.style
    ds.posLeft = (Gallery_h_align == "left") ? 0 : (b_width - w) * ((Gallery_h_align == "center") ? 0.5 : 1)
    ds.posTop = (Gallery_v_align == "top") ? 0 : (b_height - h) * ((Gallery_v_align == "center") ? 0.5 : 1)

    if (use_native_img || (image_ratio != 1)) {
      ds.pixelWidth = w
      ds.pixelHeight = h
    }
    else {
      ds.width = "auto"
      ds.height = "auto"
    }

    img_obj.initialized = true

    gallery_cache_obj.styleUpdate()
  }

  if (pic.ss_mode) {
    var x = pic.ss_x
    var y = pic.ss_y

    ds = img_obj.style
    ds.posLeft = -x
    ds.posTop = -y
    ds.clip = 'rect(' + y + 'px ' + (x+w) + 'px ' + (y+h) + 'px ' + x + 'px)'

    gallery_cache_obj.styleUpdate()
  }

// filters
  if (self.use_ghosting)
    Ghosting.frame_final()
}

function SettingsClosed(event) {
// User hits OK on the settings page.
  if (event.closeAction == event.Action.commit) {
    self.location.href = self.location.href
  }
}


// BG
var BG_dim_calculate
var BG_img_objs
var EV_width_no_init, EV_height_no_init

function BG_Basic() {
  BG_AddShadow((!filter_objs[filter_index].filter_enabled && (SA_zoom == 1)))
}

function BG_AddShadow(basic_mode) {
  BG_dim_calculate()

  var w = parseInt(EV_width * SA_zoom)
  var h = parseInt(EV_height * SA_zoom)

  var left_offset = 1
  var top_offset = 1

  var s = Lmain_obj.style
  s.posLeft = left_offset
  s.posTop = top_offset
  s.clip = Lmain_obj.clip_org = 'rect(0px ' + (w)   + 'px ' + (h)   + 'px 0px)'

  w += (left_offset * 2)
  h += (top_offset  * 2)

  EV_BG_src = ""
  BG.removeObjects()
  BG_img_objs = []

if (!basic_mode) {
  var bg_shadow = BG.addImageObject("js_filters/images/black.png", 0,0)
  bg_shadow.left = (w-100)/2
  bg_shadow.top = (h-100)/2
  bg_shadow.width = w
  bg_shadow.height = h
  bg_shadow.addShadow("black", 3, 75, 3,3)
  BG_img_objs.push(bg_shadow)

  s = LBG_dummy.style
  s.pixelWidth = w
  s.pixelHeight = h
//  s.backgroundColor = "white"
  s.display = "block"
}
else
  LBG_dummy.style.display = "none"

  EV_width  += (left_offset * 2) + 5
  EV_height += (top_offset  * 2) + 5

  BG.style.pixelWidth = EV_width * SA_zoom
  BG.style.pixelHeight = EV_height * SA_zoom
}

function BG_AddBlackhole() {
  BG_dim_calculate()

  if (System.Gadget.docked && (EV_width <= 130)) {
    BG_AddShadow()
  }
  else {
    LBG_dummy.style.display = "none"

    EV_BG_src = ""
    BG.removeObjects()
    BG_img_objs = []

    var bg_blackhole
    var bg_choice = [Settings.f_path + '\\images\\bg_blackhole.png', System.Gadget.path + '\\js_filters\\images\\bg_blackhole_' + EV_width + 'x' + EV_height + '.png']
    for (var i = 0; i < bg_choice.length; i++) {
      var bg_src = ValidatePath(bg_choice[i])
      if (bg_src) {
        bg_blackhole = bg_src.path
        break
      }
    }
    if (!bg_blackhole)
      bg_blackhole = 'js_filters/images/bg_blackhole_130x130.png'

    BG_img_objs.push(BG.addImageObject(bg_blackhole, 0,0))

    var s = Lmain_obj.style
    s.posTop = 24
    s.posLeft = 24

    EV_width += 24*2
    EV_height += 24*2
  }

  BG.style.pixelWidth = EV_width
  BG.style.pixelHeight = EV_height
}

// OP selection START

var OP_SEQ_index = -1

function OP_gallery_sorting(a, b) {
  if (a.SEQ_index == OP_SEQ_index)
    return -1
  if (b.SEQ_index == OP_SEQ_index)
    return 1

  return Math.random() - 0.5
}

function OP_change() {
  if (gallery_cache_obj.SS_mode) {
    SEQ_gallery_index = -1
    return ((SEQ_gallery_shuffled_count == -1) ? OP_SEQ_index : SEQ_gallery_shuffled[SEQ_gallery_shuffled_count].SEQ_index)
  }

  if (++OP_SEQ_index >= SEQ_gallery.length)
    OP_SEQ_index = 0

  SEQ_gallery_shuffled = SEQ_gallery.sort(OP_gallery_sorting)

  SEQ_gallery_shuffled_count = 0
  SEQ_gallery_index = -1

  return OP_SEQ_index
}

var SEQ_fps_end_factor = 1
var SEQ_fps_frame_skip_mod = 0

function OP_change_event() {
  if (gallery_cache_obj.SS_mode)
    DEBUG_show((OP_change()+1)+' (=> '+((SEQ_gallery_shuffled_count == SEQ_gallery.length-1) ? 'END' : SEQ_gallery_shuffled[SEQ_gallery_shuffled_count+1].SEQ_index+1)+')', 1)
  else
    DEBUG_show((OP_change()+1)+'/'+SEQ_gallery.length, 1)
}

// END


// Gallery building START

var gallery, gallery_js, pic_last
var image_ratio
var b_width, b_height
var B_width, B_height
var w_max, h_max
w_max = h_max = 0
var gallery_dim_predefined, gallery_preload_always
var SEQ_mode, SEQ_fps, SEQ_fps_ini, SEQ_fps_end, SEQ_ani_count, SEQ_ani_count_overridden
var SEQ_gallery_all, SEQ_gallery, SEQ_gallery_by_name, SEQ_gallery_by_percent
var SEQ_gallery_index, SEQ_gallery_percent_index, SEQ_gallery_percent_name
var SEQ_gallery_memory_saving_mode
var MacFace_mode
var use_2nd_monitor
var use_GIMAGE

var EQP_gallery

var gallery_cache_obj = new imgCache_Object("img_obj", "Lmain_animation")

function ValidatePath(path) {
  var p = null
  try {
    p = System.Shell.itemFromPath(path)
  }
  catch (ex) {}

  return p
}

function ItemsFromFolder(path, is_root) {
  var f = ValidatePath(path)

  if (!f && is_root) {
    if (path != f_path_default)
      ItemsFromFolder(f_path_default, true)
    return true
  }

  if (/\.mcface$/i.test(path)) {
    MacFace_mode = true
    use_2nd_monitor = true
    return
  }

  if (is_root) {
    if (!f.isFolder && f.isFileSystem) {
      var path = f.path
      if (/\.gif$/i.test(path)) {
        gallery = [{frame:0, path:path, path_file:toFileProtocol(path)}]

        self.EV_init = function () {
self.EV_b_width  = w_max
self.EV_b_height = h_max
        }
      }
      else if (/_gimage/i.test(path)) {
        use_native_img = true
        gallery = [{frame:0, path:path, path_file:toFileProtocol(path)}]

        self._image_ratio = parseFloat(LABEL_LoadSettings("LABEL_image_ratio", 0));
        var image_ratio_default = (System.Gadget.docked) ? 0.5 : 1
        if (_image_ratio == image_ratio_default)
          _image_ratio = 0

        self.EV_initialized = false
        self.EV_init = function () {
if (!EV_initialized) {
  EV_initialized = true
  document.body.title += ', double-click to change size'
  document.body.ondblclick = function () {
var image_ratio_default = (System.Gadget.docked) ? 0.5 : 1
if (!_image_ratio)
  _image_ratio = image_ratio_default
if (_image_ratio <= 0.25)
  _image_ratio = 1
else
  _image_ratio -= 0.25

if (_image_ratio == image_ratio_default)
  _image_ratio = 0

resize()
  }
}

if (_image_ratio)
  image_ratio = _image_ratio
DEBUG_show('Size:' + (image_ratio*100) + '%', 2)
System.Gadget.Settings.writeString("LABEL_image_ratio", image_ratio)
self.EV_b_width  = w_max_org * image_ratio
self.EV_b_height = h_max_org * image_ratio
        }
      }
      else
        EQP_gallery = [path]
      return
    }

    if (/\.EQP-gallery$/i.test(path))
      EQP_gallery = []
  }

  var SEQ_RE = /([^\/\\]+)\.SEQ\-(\d+)\-(\d+)$/i

  var SEQ_sub_obj = null
  if (SEQ_RE.test(path)) {
    SEQ_mode = true

    var fps_ini = parseInt(RegExp.$2)
    if (fps_ini < 1)
      fps_ini = 1
    else if (fps_ini > 30)
      fps_ini = 30

    var fps_end = parseInt(RegExp.$3)
    if (fps_end < 1)
      fps_end = 1
    else if (fps_end > 30)
      fps_end = 30

    var s_name = RegExp.$1
    if (!is_root && SEQ_gallery_by_name[s_name])
      s_name += "|" + path
    SEQ_sub_obj = { SEQ_name:s_name, SEQ_fps_ini:fps_ini, SEQ_fps_end:fps_end, loop_factor:1, count:0 }

    if (is_root) {
      SEQ_gallery_all = []
      SEQ_gallery = []
      SEQ_gallery_by_name = {}
      SEQ_gallery_by_percent = []

      SEQ_fps_ini = SEQ_fps_end = 1
      SEQ_ani_count = 0
      SEQ_gallery_index = -1
      SEQ_gallery_percent_index = -1
    }
  }
  else if (is_root)
    SEQ_mode = false

  var g = []
  var ss_frame_count = 0
  var ss_path_list = []
  var ss_w = 0
  var ss_h = 0

  var ss_path_raw_list = []
  var ss_ref_frame = {}
  var ss_frame_copy = {}

  var items = f.SHFolder.Items
  for (var i = 0; i < items.count; i++) {
    var item = items.item(i)

    if (item.isLink) {
      var item_linked
      try {
        item_linked = System.Shell.itemFromPath(item.link.path)
      }
      catch (ex) {}

      if (!item_linked)
        continue

      item = item_linked
    }

    if (item.isFolder) {
// Settings.to_include_subfolders
      if (SEQ_mode && SEQ_RE.test(item.path)) {
        if (!ItemsFromFolder(item.path))
          return false
      }
    }
    else if (item.isFileSystem) {
      var path = item.path

      if (is_root && /animate\.js$/i.test(path)) {
        gallery_js = path
        continue
      }

      if (EQP_gallery) {
        if (!/\.(bmp|gif|jpg|jpeg|png|wmv|mp4)$/i.test(path))
          continue

        if (/\.(wmv|mp4)$/i.test(path))
          use_Silverlight = true

        EQP_gallery.push(path)
        continue
      }

      if (!/\.(bmp|gif|jpg|jpeg|png)$/i.test(path))
        continue

      var frames = []
      var FO = null

      if (/[\\\/](\d+)(x\d+)?\.\w+$/i.test(path)) {
        var frame = parseInt(RegExp.$1)

        var frame_copy = 1
        if (RegExp.$2) {
          if (/x(\d+)/i.test(RegExp.$2))
            frame_copy = parseInt(RegExp.$1)
        }

        frames[0] = { frame:frame, frame_copy:frame_copy }
      }
      else if (/ss\-(\d+)x(\d+)\-(\d+)(_[x\-\d]+)?\.\w+$/i.test(path)) {
gallery_cache_obj.SS_mode = true
SEQ_gallery_memory_saving_mode = true
        var w, h
        w = ss_w = parseInt(RegExp.$1)
        h = ss_h = parseInt(RegExp.$2)
        var frames_max = parseInt(RegExp.$3)

        var frame_copy_list = []
        if (RegExp.$4) {
          var fc_str = RegExp.$4
          var fc = fc_str.replace(/^_/, "").split("-")
          for (var k = 0; k < fc.length; k++) {
            if (/(\d+)x(\d+)/i.test(fc[k]))
              frame_copy_list[RegExp.$1] = parseInt(RegExp.$2)
          }
        }

        for (var k = 0; k < frames_max; k++) {
          var x = (k % 10)
          var y = parseInt(k/10)

          var frame = ss_frame_count + k

          var frame_copy = frame_copy_list[k]
          if (frame_copy)
            ss_frame_copy[frame] = frame_copy
          else
            frame_copy = 1

          frames.push({ frame:frame, frame_copy:frame_copy,  ss_mode:true, ss_x:x*w, ss_y:y*h, w:w, h:h })
        }

        FO = FrameObject()
      }
      else
        continue

      var path_file = toFileProtocol(path)
      ss_path_raw_list.push(path)
      ss_path_list.push(path_file)

if (!SEQ_gallery_memory_saving_mode) {
  for (var k = 0; k < frames.length; k++) {
    var ff = frames[k]

    var frame = ff.frame
    var obj = (FO) ? new FO(frame) : { frame:frame }

    var is_ref_frame = (!ff.ss_mode || (frame == ss_frame_count))
    var obj_ref = obj
    if (is_ref_frame) {
      if (ff.ss_mode) {
        obj_ref = FO.prototype

        obj_ref.ss_mode = true
        obj_ref.w = ff.w
        obj_ref.h = ff.h
      }
      obj_ref.path = path
      obj_ref.path_file = path_file
    }

    if (ff.ss_mode) {
      obj.ss_x = ff.ss_x
      obj.ss_y = ff.ss_y
    }

    for (var c = 0; c < ff.frame_copy; c++)
      g.push(obj)
  }
}

      ss_ref_frame[ss_frame_count] = true

      ss_frame_count += frames_max
      if (ss_frame_count > 999)
        return false
    }
  }

  if (SEQ_sub_obj && (g.length || ss_frame_count)) {
    SEQ_sub_obj.ss_w = ss_w
    SEQ_sub_obj.ss_h = ss_h
    if (SEQ_gallery_memory_saving_mode) {
      SEQ_sub_obj.ss_frame_count = ss_frame_count
      SEQ_sub_obj.ss_path_raw_list = ss_path_raw_list
      SEQ_sub_obj.ss_frame_copy = ss_frame_copy
      SEQ_sub_obj.ss_ref_frame = ss_ref_frame
    }
    else {
      SEQ_sub_obj.gallery = g
    }

    if (ss_path_list.length)
      SEQ_sub_obj.ss_path_list = ss_path_list

    if (!is_root || !SEQ_gallery.length) {
      SEQ_sub_obj.SEQ_index = SEQ_gallery.length
      SEQ_gallery_all.push(SEQ_sub_obj)
      SEQ_gallery.push(SEQ_sub_obj)
      SEQ_gallery_by_name[SEQ_sub_obj.SEQ_name] = SEQ_sub_obj
    }
  }

  if (is_root) {
    if (SEQ_mode && SEQ_gallery.length)
      gallery = (SEQ_gallery[0].gallery) ? SEQ_gallery[0].gallery : SEQ_generate_gallery(SEQ_gallery[0])
    else
      gallery = g
  }

  return true
}

// To reduce memory usage by assigning a constructor to all frames of the same sprite sheet, and use prototyping on repeated properties
function FrameObject() {
  return (function (frame) { this.frame=frame })
}

var SEQ_gallery_ref

function SEQ_generate_gallery(g_obj) {
  var max = g_obj.ss_frame_count
  var ss_frame_copy = g_obj.ss_frame_copy
  var ss_ref_frame = g_obj.ss_ref_frame
  var w = g_obj.ss_w
  var h = g_obj.ss_h

  var path_index = 0

  var FO
  var g = []
  for (var frame = 0; frame < max; frame++) {
    var is_ref_frame = ss_ref_frame[frame]
    if (is_ref_frame)
      FO = FrameObject()

    var obj = new FO(frame)

    if (is_ref_frame) {
      var path = g_obj.ss_path_raw_list[path_index++]
      var path_file = toFileProtocol(path)

      var obj_ref = FO.prototype
      obj_ref.ss_mode = true
      obj_ref.w = w
      obj_ref.h = h
      obj_ref.path = path
      obj_ref.path_file = path_file
    }

    obj.ss_x = (frame % 10) * w
    obj.ss_y = parseInt(frame/10) * h

    var frame_copy = ss_frame_copy[frame]
    if (!frame_copy)
      frame_copy = 1

    for (var c = 0; c < frame_copy; c++)
      g.push(obj)
  }

  SEQ_gallery_ref = g
  return g
}

function loadImageDimALL() {
  if (!SEQ_mode) {
      for (var k = 0; k < gallery.length; k++) {
        var obj = gallery[k]
        var dim = loadImageDim(obj.path, obj)

        var w,h
        obj.w = w = dim.w
        obj.h = h = dim.h

        if (w_max < w)
          w_max = w
        if (h_max < h)
          h_max = h
      }
  }
  else {
    for (var i = 0; i < SEQ_gallery_all.length; i++) {
      var g_obj = SEQ_gallery_all[i]
      if (g_obj.ss_w) {
        var w = g_obj.ss_w
        var h = g_obj.ss_h

        if (w_max < w)
          w_max = w
        if (h_max < h)
          h_max = h

        continue
      }

      var g = g_obj.gallery
      for (var k = 0; k < g.length; k++) {
        var obj = g[k]
        var dim = loadImageDim(obj.path, obj)

        var w,h
        obj.w = w = dim.w
        obj.h = h = dim.h

        if (w_max < w)
          w_max = w
        if (h_max < h)
          h_max = h
      }
    }
  }

/*
  if (w_max && h_max)
    DEBUG_show(w_max + "x" + h_max, 2)
*/
}

function loadImageDim(path, obj) {
  if (obj && obj.w && obj.h)
    return { w:obj.w, h:obj.h }

  var item = ValidatePath(path)
  if (!item)
    return { w:0, h:0 }

  var w,h
  var meta_dim
  if (Vista_or_above)
    meta_dim = item.metadata("Dimensions")
  else if (Shell_OBJ) {
    try {
      var f = path.replace(/\\[^\\]+$/, "")
      var p = path.replace(/^.+\\/, "")

      var dir = Shell_OBJ.NameSpace(f);
      var img = dir.ParseName(p);

      meta_dim = img.ExtendedProperty("Dimensions");
      if (!meta_dim)
        meta_dim = dir.GetDetailsOf(img, 26);
    }
    catch (err) {}
  }

  if (meta_dim && /(\d+)\D+(\d+)/.test(meta_dim)) {
    w = parseInt(RegExp.$1)
    h = parseInt(RegExp.$2)
  }
  else {
    w = 130
    h = 130
  }

  return { w:w, h:h }
}

var SA_extra_info_on

var SEQ_SP_gallery = []
var SEQ_SP_gallery_index = 0
var SEQ_SP_pic_index = -1
var SEQ_SP_finished

function SEQ_SmartPreloading() {
  if (EV_usage > 5)
    return

  if (!SEQ_SP_gallery.length)
    SEQ_SP_gallery = (SEQ_gallery_by_percent.length || !SEQ_gallery_shuffled.length) ? SEQ_gallery_all : SEQ_gallery_shuffled.slice(0)

  var preload_count = 10
  while ((!SEQ_SmartPreloading_Core()) && (--preload_count > 0)) {}

if (!preload_count && SA_extra_info_on)
DEBUG_show('(SP)',1)
}

function SEQ_SmartPreloading_Core() {
  if (++SEQ_SP_pic_index >= SEQ_SP_gallery[SEQ_SP_gallery_index].gallery.length) {
    SEQ_SP_pic_index = 0
    if (++SEQ_SP_gallery_index >= SEQ_SP_gallery.length) {
//DEBUG_show('(SP Finished)',2)
      SEQ_SP_finished = true
      Seq.item("SEQ_SmartPreloading").Stop()
      return true
    }
  }

  var pic = SEQ_SP_gallery[SEQ_SP_gallery_index].gallery[SEQ_SP_pic_index]
  if (pic.w && pic.h)
    return false

if (SA_extra_info_on)
DEBUG_show('(SP ' + (SEQ_SP_pic_index+1) + '/' + (SEQ_SP_gallery_index+1) + '/' + SEQ_SP_gallery.length + ')',1)
  var dim = loadImageDim(pic.path)
  pic.w = dim.w
  pic.h = dim.h
  return true
}

function LABEL_LoadSettings(name, v_default) {
  if (Settings.LABEL_matched) {
    var v = System.Gadget.Settings.readString(name)
    return ((v) ? v : v_default)
  }

  System.Gadget.Settings.writeString(name, "")
  return v_default
}

function loadFolder() {
  Settings.f_path = System.Gadget.Settings.readString("Folder")
  if (Settings.f_path)
    Settings.f_path = (/^demo\d+$/.test(Settings.f_path)) ? path_demo[Settings.f_path] : Settings.f_path
  else
    Settings.f_path = f_path_default

  Settings.LABEL_f_path = System.Gadget.Settings.readString("LABEL_Folder")
  if (Settings.LABEL_f_path && (Settings.LABEL_f_path == Settings.f_path))
    Settings.LABEL_matched = true
  else
    System.Gadget.Settings.writeString("LABEL_Folder", Settings.f_path)

  Settings.to_include_subfolders = returnBoolean("IncludeSubfolders")

// main
  gallery = []
  pic_last = null

  ItemsFromFolder(Settings.f_path, true)
  if (MacFace_mode) {
    document.write(
  '<script language="JavaScript" src="js/PlistXMLParser.js"></scr'+'ipt>\n'
+ '<script language="JavaScript" src="js/vistaFace.js"></scr'+'ipt>'
    )

    return
  }
  if (!gallery_js && !gallery.length && (!EQP_gallery || !EQP_gallery.length)) {
    EQP_gallery = null
    ItemsFromFolder(f_path_default, true)
  }

  if (gallery_js)
    document.write('<script language="JavaScript" src="' + toFileProtocol(gallery_js) + '"></scr'+'ipt>')
  else if (!EQP_gallery && returnBoolean("UseFilters"))
    document.write('<script language="JavaScript" src="js_filters/animate.js"></scr'+'ipt>')

  if (EQP_gallery)
    document.write('<script language="JavaScript" src="js/EQP_gallery.js"></scr'+'ipt>')

  if (gallery.length && !gallery_cache_obj.SS_mode) {
    var galleries = (SEQ_gallery) ? SEQ_gallery : [{gallery:gallery}]

    for (var i = 0; i < galleries.length; i++)
      galleries[i].gallery.sort(function (a,b) { return a.frame - b.frame })
  }
}

loadFolder()
