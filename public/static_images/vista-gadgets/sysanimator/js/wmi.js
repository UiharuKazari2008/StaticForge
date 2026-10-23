// WMI JS library version 1.0
// NOTE: "SWbemRefresher" can be used ONLY on "Win32_Perf" data. Using it on other objects causes MEMORY LEAK.

var WMI_obj
var WMI_objs_count = 0
var WMI_refreshers = []
var WMI_refreshers_count = 0

var PC_count_absolute = 0

function WMI_Refresher(WMI_class, refresher_id) {
  this.loaded = false
  this.refresher = null
  this.objs = null

  this.WMI_class = WMI_class
  this.refresher_id = (refresher_id) ? refresher_id : null

  this.init = WMI_Refresher_init
  this.update = WMI_Refresher_update
  this.refresh = WMI_Refresher_refresh
}

function WMI_Refresher_init() {
  if (this.loaded)
    return
  this.loaded = true
  WMI_objs_count++

try {
  if (!WMI_obj)
    WMI_obj = GetObject("winmgmts:")

  if (!this.refresher_id)
    return

  var r = WMI_refreshers[this.refresher_id]
  if (!r) {
    r = { obj:new ActiveXObject("WbemScripting.SWbemRefresher") }
    WMI_refreshers[this.refresher_id] = r
    WMI_refreshers_count++
  }

  this.refresher = r
  this.objs = r.obj.AddEnum(WMI_obj, this.WMI_class)
}
catch (ex) {}

}

function WMI_Refresher_refresh() {

try {
  if (!this.refresher_id)
    return

  var r = this.refresher
  if (r.refreshed_count_last == PC_count_absolute)
    return

  r.refreshed_count_last = PC_count_absolute
  r.obj.Refresh()
}
catch (ex) {}

}

function WMI_Refresher_update() {
  var objs = []
try {
  this.refresh()

  var en_objs = (this.refresher_id) ? this.objs.ObjectSet : WMI_obj.InstancesOf(this.WMI_class)
  var en = new Enumerator(en_objs)
  for (; !en.atEnd(); en.moveNext())
    objs.push(en.item())
}
catch (ex) {}

  this.collection = objs
  return objs
}
