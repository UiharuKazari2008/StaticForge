// Windows Media Player control for Silverlight animation (v1.0.4)

var WMP_left, WMP_top, WMP_width, WMP_height
var WMP_mask
var WMP_func_extra

var WMP = {
   player:null
  ,div:null
  ,src:""
  ,in_use:false

  ,dragdrop_RE: /\.(wav|mp3|wma|avi|mpg|rmvb|mkv|wmv|mp4)$/i
  ,hiding_timerID:null

  ,show: function () {
DEBUG_show('(WMP Start)', 2)

this.in_use = this.player.enabled = true
this.div.style.visibility = "inherit"
this.resize()

//SL_Host.style.visibility = "hidden"

if (WMP_mask)
  SL_root.FindName('content_mask').ImageSource = toFileProtocol(WMP_mask)

if (WMP_func_extra)
  WMP_func_extra()
   }

  ,hide: function () {
DEBUG_show('(WMP End)', 2)

try { WMP.player.controls.stop() } catch (err) {}
this.hiding_clear()
SL_root.FindName("C_media_control").Visibility = "Collapsed"

this.in_use = this.player.enabled = false
this.div.style.visibility = "hidden"
this.resize()

if (WMP_mask)
  SL_root.FindName('content_mask').ImageSource = null

if (WMP_func_extra)
  WMP_func_extra()
   }

  ,hiding: function () {
this.hiding_clear()
this.hiding_timerID = setTimeout('WMP.hiding_timerID=null; WMP.hide();', 5000)
   }

  ,hiding_clear: function () {
if (this.hiding_timerID) {
  clearTimeout(this.hiding_timerID)
  this.hiding_timerID = null
}
   }

  ,load: function (src) {
this.src = src

EQP_Hide_Video()

if (this.player) {
  this.show()
  this.player.URL = src
  return
}

if (!WMP_left)
  WMP_left = 0
if (!WMP_top)
  WMP_top = 0
if (!WMP_width)
  WMP_width  = (self.EQP_gallery_obj_active) ? (EQP_gallery_obj_active.w_org - EQP_gallery_obj_active.x_offset*2) : EQP_SL_w
if (!WMP_height)
  WMP_height = (self.EQP_gallery_obj_active) ? (EQP_gallery_obj_active.h_org - EQP_gallery_obj_active.y_offset*2) : EQP_SL_h

var div
div = this.div = document.createElement("div")
var ds = div.style
ds.position = "absolute"
ds.posLeft = 0
ds.posTop = 0
ds.overflow = "hidden"
//ds.backgroundColor = "gray"
document.body.appendChild(div)

div.innerHTML = 
  '<object id="WMP_player" classid="CLSID:6BF52A52-394A-11d3-B153-00C04F79FAA6" '
+ 'style="position:absolute; top:0px; left:0px">\n'
+ '<PARAM name="autoStart" value="True">\n'
+ '<PARAM name="windowlessVideo" value="True">\n'
+ '<PARAM name="uiMode" value="None">\n'
+ '<PARAM name="stretchToFit" value="True">\n'
+ '<PARAM name="URL" value="' + src + '">\n'
+ '</object>'
   }

  ,resize: function () {
if (!WMP.in_use)
  return

var ws = WMP.div.style
var ss = SL_Host_Parent.style
ws.pixelWidth = ss.pixelWidth
ws.pixelHeight = ss.pixelHeight
ws.posLeft = ss.posLeft
ws.posTop = ss.posTop

var ps = document.getElementById("WMP_player").style
ps.posLeft = Math.round(WMP_left * EQP_size_scale)
ps.posTop  = Math.round(WMP_top  * EQP_size_scale)
ps.pixelWidth  = Math.round(WMP_width  * EQP_size_scale)
ps.pixelHeight = Math.round(WMP_height * EQP_size_scale)
   }

// events
  ,dragdrop: function(item, no_default) {
var src = item.path
if (item.isFileSystem && WMP.dragdrop_RE.test(src)) {
  if (!SL_windowless) {
    DEBUG_show('(WMP not supported in Windowed mode)', 5)
    return false
  }

  WMP.load(item.path)
  return true
}

if (no_default)
  return false
DragDrop_install(item)
   }

  ,OpenStateChange: function (NewState) {
if (this.player)
  return

this.player = WMP_player
this.player.settings.volume = 100

if (WMP_mask) {
  var mask_path = (EQP_parts_path) ? EQP_parts_path + '\\' : 'mask\\';
  WMP_mask = Settings.f_path + '\\' + mask_path + WMP_mask + '.png';
}

this.show()
   }

  ,PlayStateChange: function (NewState) {
// Fixing a strange bug in IE8/9 documnt mode
if (ie8_mode)
  setTimeout('WMP.resize()', 0)

if (NewState == 1 || NewState == 8)
  WMP.hiding()
else
  WMP.hiding_clear()
   }

  ,dragdrop_init: function () {
DragDrop_RE = /\.(bmp|gif|jpg|jpeg|png|wmv|mp4|wav|mp3|wma|avi|mpg|rmvb|mkv)$/i

if (self.EQP_dragdrop_target || self.EQP_dragdrop_obj)
  WMP.dragdrop_RE = /\.(wav|mp3|wma|avi|mpg|rmvb|mkv)$/i
else
  DragDrop.onDrop_finish = WMP.dragdrop
   }
}
