// basics
var ie_64bit = /Win64.+x64/i.test(navigator.userAgent)
//ie_64bit=true
var ie9 = /Trident.[5-9]/i.test(navigator.userAgent)
var ie9_mode = (document.documentMode >= 9)
var ie8_mode = (document.documentMode >= 8)


//System.Gadget.Settings
var Settings_default = {
   Folder: "demo1"

  ,EventToMonitor: "CPU"
  ,EventToMonitorVF: ""
  ,MonitorSensitivity: "1"
  ,Monitor2Sensitivity: "1"
  ,UpdateInterval: "10"
  ,Display: "1"

  ,IncludeSubfolders: false
  ,ReverseAnimation: false
  ,UseFilters: false
  ,UseMarkers: false
  ,UseImgCache: false

  ,UseSilverlight: !ie_64bit
  ,UseSL_windowless: !ie_64bit

  ,TimerDelay: "1.25"

// obsolete
  ,HandleOversize: "crop"
}


function returnBoolean(name) {
  return ((!System.Gadget.Settings.readString(name)) ? Settings_default[name] : !Settings_default[name])
}