// SA Silverlight (v1.1.3)

var use_Silverlight
var use_Silverlight_only

if (ie_64bit)
  use_Silverlight = false

var SL_loaded
var SL_root, SL_content

var SL_windowless// = false

var SL_PP_is_reset = true
var SL_PP_enabled

var SL_ST_enabled

var EV_SL_init

function SL_Init(bg_color) {
  if (SL_loaded)
    return

  if (!bg_color)
    bg_color = "black"

  if (SL_windowless == null)
    SL_windowless = returnBoolean("UseSL_windowless")

  var paras = {
	width:"130", height:"130",
	version:"3.0.40624.0", autoUpgrade:'true'
  };

  if (SL_windowless) {
    paras.windowless = 'true'
    bg_color = "transparent"
  }
  paras.background = bg_color

  var d = document.createElement("div")
  var ds = d.style
  d.id = "SL_Host_Parent"
  ds.position = "absolute"
  ds.posLeft = 0
  ds.posTop = 0
  ds.zIndex = 10
  ds.backgroundColor = bg_color
  if (!SL_windowless) {
    ds.cursor = "move"
    d.title = "Drag to move this gadget."
  }
  document.body.appendChild(d)

  var d = document.createElement("div")
  var ds = d.style
  d.id = "SL_Host"
  ds.position = "absolute"
  ds.posLeft = 0
  ds.posTop = 0
  SL_Host_Parent.appendChild(d)

  d.innerHTML = Silverlight.createObject(
	"js/SA_silverlight.xml",
	null, "SL",
	paras,
	{ onError: onSLError, onLoad: onSLLoad },
	"param1=value1,param2=value2", "SL_Host"
  );

// WMP
  if (self.WMP)
    WMP.dragdrop_init()
}

        function onSLLoad(plugIn, userContext, sender) {
if (!SL_loaded) {
  SL_loaded = true

  SL_root = sender
  SL_content = SL_root.FindName("C_content")

var SL_info = []
if (SL_windowless && use_WMP)
  SL_info.push('WMP')
if (self.EQP_dragdrop_target || self.EQP_dragdrop_obj)
  SL_info.push('Video')
if (!SL_windowless)
  SL_info.push('WINDOWED')
DEBUG_show('Silverlight' + ((SL_info.length) ? '(' + SL_info.join('/') + ')': ''), 2)
//DEBUG_show(navigator.userAgent,0,true)

//SL.settings.MaxFrameRate = 15

  if (SL_PP_enabled == null)
    SL_PP_enabled = true

  if (SL_ST_enabled == null)
    SL_ST_enabled = true
//SL_ST_enabled=false
  self.EQP_allow_resize = true

  SL.Content.OnFullScreenChange = function () {
EQP_resize()

if (SL.content.fullScreen) {
  var ss = SL_Host_Parent.style
  var sw = ss.pixelWidth  * SL_fullscreen_scale
  var sh = ss.pixelHeight * SL_fullscreen_scale

  SL_root["Canvas.Left"] = (screen.width  - sw) / 2
  SL_root["Canvas.Top"] = (screen.height - sh) / 2
}
else
  SL_root["Canvas.Left"] = SL_root["Canvas.Top"] = 0

if (use_WMP && WMP.in_use) {
  if (WMP_mask)
    SL_root.FindName('content_mask').ImageSource = (SL.content.fullScreen) ? null : toFileProtocol(WMP_mask)
}
  }

  if (EV_SL_init)
    EV_SL_init()
  return
}
        }

        function onSLError(sender, args) {
            // Display error message.
DEBUG_show("Silverlight ERROR:" + args.errorType, 0, true)
        }


var SL_fullscreen_scale = 1

function SL_Get_FullScreen_Scale(w, h) {
  if (!use_Silverlight || !SL_loaded || !SL.content.fullScreen) {
    SL_fullscreen_scale = 1
    return 1
  }

  if (!w) {
    var ss = SL_Host_Parent.style
    w = ss.pixelWidth
    h = ss.pixelHeight
  }

  var sw = screen.width
  var sh = screen.height

  var scale_w = sw / w
  var scale_h = sh / h
  SL_fullscreen_scale = (scale_w < scale_h) ? scale_w : scale_h

  return SL_fullscreen_scale
}

var SL_locked = true

function SL_ArrangeButtons() {
  SL_Get_FullScreen_Scale()

  SL_CenterMediaControl()
  SL_CenterLockPanel()

  var ss = SL_Host_Parent.style
  var sw = ss.pixelWidth  * SL_fullscreen_scale
  var sh = ss.pixelHeight * SL_fullscreen_scale

  var b
  b = SL_root.FindName("B_scale_up")
  b["Canvas.Left"] = (sw - 16) - 5
  b["Canvas.Top"] = (sh - 16) - 5
  b = SL_root.FindName("B_fullscreen")
  b["Canvas.Left"] = (sw  - 16) - 5
  b["Canvas.Top"] = 5

  if (use_WMP)
    WMP.resize()
}

function SL_CenterLockPanel() {
  var w = 116
  var h = 24

  var ss = SL_Host_Parent.style
  var sw = ss.pixelWidth  * SL_fullscreen_scale
  var sh = ss.pixelHeight * SL_fullscreen_scale

  if (SL_locked) {
    SL.width  = sw
    SL.height = sh
    SL_Host.style.posLeft = SL_Host.style.posTop = 0
  }
  else {
    SL_Host.style.posLeft = (sw - w) / 2
    SL_Host.style.posTop  = (sh - h) / 2
    return
  }

  if (SL_windowless)
    return
  var lp = SL_root.FindName("C_lock_panel")
  lp["Canvas.Left"] = Math.round((sw  - w) / 2)
  lp["Canvas.Top"] = Math.round((sh - h) / 2)
}

var SL_CenterMediaControl_x, SL_CenterMediaControl_y

function SL_CenterMediaControl() {
  var w = 150
  var h = 30

  var ss = SL_Host_Parent.style
  var sw = ss.pixelWidth  * SL_fullscreen_scale
  var sh = ss.pixelHeight * SL_fullscreen_scale

  var mc = SL_root.FindName("C_media_control")
  mc["Canvas.Left"] = (SL_CenterMediaControl_x != null) ? SL_CenterMediaControl_x : Math.round((sw - w) / 2)
  mc["Canvas.Top"] = (SL_CenterMediaControl_y != null) ? SL_CenterMediaControl_y : (sh - h) - 10

  var scale = EQP_size_scale / 2 + 0.5
  var st = SL_root.FindName("MC_ST")
  st.ScaleX = st.ScaleY = scale
}


// Mouse events
var EV_SL_MouseDown, EV_SL_MouseUp, EV_SL_MouseClick, EV_SL_MouseDoubleClick
var SL_mouse_down_start, SL_mouse_click_start

function SL_MouseDown(sender, args) {
//DEBUG_show('mouse down',2)
  if (EV_SL_MouseDown && EV_SL_MouseDown(sender, args))
    return

  var d = new Date()
  SL_mouse_down_start = d.getTime()
}

function SL_MouseUp(sender, args) {
//DEBUG_show('mouse up',2)
  if (EV_SL_MouseUp && EV_SL_MouseUp(sender, args))
    return

  var d = new Date()
  var t = d.getTime()

  if (SL_mouse_down_start && (t - SL_mouse_down_start < 250))
    SL_MouseClick(sender, args)
  SL_mouse_down_start = null
}

function SL_MouseClick(sender, args) {
//DEBUG_show('click',2)
  if (SL_windowless && !SL.content.fullScreen) {
    SL_MouseDoubleClick(sender, args)
    return
  }
  if (EV_SL_MouseClick && EV_SL_MouseClick(sender, args))
    return

  var d = new Date()
  var t = d.getTime()

  if (SL_mouse_click_start && (t - SL_mouse_click_start < 500)) {
    SL_MouseDoubleClick(sender, args)
    SL_mouse_click_start = null
  }
  else
    SL_mouse_click_start = t
}

function SL_MouseDoubleClick(sender, args) {
//DEBUG_show('double-click',2)
  if (EV_SL_MouseDoubleClick && EV_SL_MouseDoubleClick(sender, args))
    return
}

EV_SL_MouseDoubleClick = function (sender, args) {
  var p = args.GetPosition(null)
  var x = p.x - SL_root["Canvas.Left"]
  var y = p.y - SL_root["Canvas.Top"]

  var w = SL.width
  var h = SL.height

  var is_fullscreen = SL.content.fullScreen
  if (SL_PP_enabled && ((x > w*0.9) && (y < h*0.1))) {
    if (EQP_size_scale == 1)
      SL.content.fullScreen = !is_fullscreen
    else {
      EQP_size_scale = 1
      EQP_size_scale_auto = false
      resize()
    }
    return false
  }

if (!is_fullscreen) {
  var scale_inc = (SL_ST_enabled) ? 0.25 : 0.5
  var scale = EQP_size_scale
  if ((x < w*0.1) && (y < h*0.1)) {
    scale -= scale_inc
    if (scale < scale_inc)
      return false
  }
  if ((x > w*0.9) && (y > h*0.9)) {
    scale += scale_inc
    if (scale > 1)
      return false
  }

  if (EQP_size_scale != scale) {
    EQP_size_scale = scale
    EQP_size_scale_auto = false
    resize()
    return false
  }
}

  var RX, RY, RZ
  RX = RY = RZ = 0
  var CX, CY, CZ
  CX = CY = CZ = 0.5

  var reset_PP = false

  var PP = SL_root.FindName("content_PP")
  if (x < w*0.1) {
    RY = PP.RotationY - 15
    if (RY < -75) {
      RY = 0
      reset_PP = true
    }
    CX = 0
  }
  else if (x > w*0.9) {
    RY = PP.RotationY + 15
    if (RY > 75) {
      RY = 0
      reset_PP = true
    }
    CX = 1
  }
  else if (y < h*0.1) {
    RX = PP.RotationX + 15
    if (RX > 75) {
      RX = 0
      reset_PP = true
    }
    CY = 0
  }
  else if (y > h*0.9) {
    RX = PP.RotationX - 15
    if (RX < -75) {
      RX = 0
      reset_PP = true
    }
    CY = 1
  }
  else {
    reset_PP = true
    if (!is_fullscreen && SL_PP_is_reset && document.body.ondblclick)
      document.body.ondblclick({ clientX:x, clientY:y })
  }

  if (!SL_PP_enabled) {
    if (!reset_PP) {
//DEBUG_show('3D-Flip:OFF', 2)
      if (!is_fullscreen && document.body.ondblclick)
        document.body.ondblclick({ clientX:x, clientY:y })
    }
    return false
  }

  SL_PP_is_reset = reset_PP

  if (self.EQP_gallery_obj_active && EQP_gallery_obj_active.html_bg)
    EQP_gallery_obj_active.html_bg.style.visibility = (reset_PP) ? "inherit" : "hidden"

  PP.RotationX = RX
  PP.RotationY = RY
  PP.CenterOfRotationX = CX * SL_fullscreen_scale
  PP.CenterOfRotationY = CY * SL_fullscreen_scale

  return false
}

var EV_SL_MouseEnter, EV_SL_MouseLeave

function SL_MouseEnter(sender, args) {
  if (EV_SL_MouseEnter && EV_SL_MouseEnter(sender, args))
    return

  if (use_WMP && WMP.in_use)
    SL_Media_MouseEnter(sender, args)

  SL_root.FindName("C_lock_panel").Visibility = (SL_windowless || SL.content.fullScreen) ? "Collapsed" : "Visible"
}

function SL_MouseLeave(sender, args) {
  if (EV_SL_MouseLeave && EV_SL_MouseLeave(sender, args))
    return

  SL_root.FindName("B_scale_down").Visibility = "Collapsed"
  SL_root.FindName("B_scale_up").Visibility = "Collapsed"
  SL_root.FindName("B_fullscreen").Visibility = "Collapsed"
  SL_root.FindName("C_media_control").Visibility = "Collapsed"
  SL_Tooltip_Hide()

  if (SL_windowless || !SL_locked)
    return

  SL_root.FindName("C_lock_panel").Visibility = "Collapsed"
}

var EV_SL_MouseMove
var SL_mouse_x, SL_mouse_y

function SL_MouseMove(sender, args) {
  if (EV_SL_MouseMove && EV_SL_MouseMove(sender, args))
    return

  var p = args.GetPosition(null)
  var x,y
  x = SL_mouse_x = p.x - SL_root["Canvas.Left"]
  y = SL_mouse_y = p.y - SL_root["Canvas.Top"]

  var w = SL.width
  var h = SL.height

  var is_fullscreen = SL.content.fullScreen

  var msg = ""
  var clickable
  if (SL_PP_enabled) {
    if ((x < w*0.1) || (x > w*0.9) || (y < h*0.1) || (y > h*0.9)) {
      //msg = "Double-click to perform a 3D-flip."
      clickable = true
    }
    else if (!SL_PP_is_reset)
      msg = "Double-click to reset 3D."
  }

  var scale_up, scale_down, fullscreen
  if (!is_fullscreen && (EQP_size_scale > 0.25) && ((x < w*0.1) && (y < h*0.1))) {
    msg = "Double-click to scale down."
    scale_down = true
  }
  else if (!is_fullscreen && (EQP_size_scale < 1) && ((x > w*0.9) && (y > h*0.9))) {
    msg = "Double-click to scale up."
    scale_up = true
  }
  else if (SL_ST_enabled && ((x > w*0.9) && (y < h*0.1))) {
    if (EQP_size_scale == 1)
      msg = "Double-click to " + ((SL.content.fullScreen) ? "leave" : "go") + " Full-Screen."
    else
      msg = "Doule-click to maximize."
    fullscreen = true
  }

  SL_root.FindName("B_scale_down").Visibility = (scale_down) ? "Visible" : "Collapsed"
  SL_root.FindName("B_scale_up").Visibility = (scale_up) ? "Visible" : "Collapsed"
  SL_root.FindName("B_fullscreen").Visibility = (fullscreen) ? "Visible" : "Collapsed"

  if (msg)
    clickable = true

  SL_root.Cursor = (clickable) ? "Hand" : "Default"

  if (!msg) {
    if (!SL_tooltip_msg_custom)
      SL_Tooltip_Hide()
    return
  }

  var tt = SL_root.FindName("C_tooltip")
  var tt_text = SL_root.FindName("C_tooltip_text")
  if ((tt.Visibility == "Visible") && (msg == tt_text.Text))
    return

  SL_Tooltip_Show(msg)
}

var SL_tooltip_show_timerID, SL_tooltip_hide_timerID
var SL_tooltip_msg
var SL_tooltip_msg_custom

function SL_Tooltip_Show(msg) {
  SL_tooltip_msg = (msg != SL_root.FindName("C_tooltip_text").Text) ? msg : null

  if (SL_tooltip_show_timerID)
    return
  SL_tooltip_show_timerID = setTimeout('SL_Tooltip_Show2()', 250)
}

function SL_Tooltip_Show2() {
  var tt = SL_root.FindName("C_tooltip")

  if (SL_tooltip_msg) {
    var tt_text = SL_root.FindName("C_tooltip_text")
    tt_text.Text = SL_tooltip_msg

    var r = SL_root.FindName("R_tooltip")
    tt.Width  = r.Width  = tt_text.ActualWidth  + 6
    tt.Height = r.Height = tt_text.ActualHeight + 6
  }

  var w = tt.Width
  var h = tt.Height

  var ss = SL_Host_Parent.style
  var sw = ss.pixelWidth  * SL_fullscreen_scale
  var sh = ss.pixelHeight * SL_fullscreen_scale

  var x_final = (SL_mouse_x + (w+10) < sw) ? SL_mouse_x+10 : SL_mouse_x - (w+10)
  var y_final = (SL_mouse_y + (h+10) < sh) ? SL_mouse_y+10 : SL_mouse_y - (h+10)

  tt["Canvas.Left"] = x_final
  tt["Canvas.Top"] = y_final

  SL_tooltip_show_timerID = null
  SL_root.FindName("C_tooltip").Visibility = "Visible"

  SL_Tooltip_Hide(3000)
}

function SL_Tooltip_Hide(ms) {
  if (!ms)
    ms = 500

  if (SL_tooltip_show_timerID) {
    clearTimeout(SL_tooltip_show_timerID)
    SL_tooltip_show_timerID = null
    return
  }

  if (SL_tooltip_hide_timerID) {
    clearTimeout(SL_tooltip_hide_timerID)
    SL_tooltip_hide_timerID = null
  }
  if (SL_root.FindName("C_tooltip").Visibility != "Collapsed")
    SL_tooltip_hide_timerID = setTimeout('SL_tooltip_hide_timerID=null; SL_tooltip_msg_custom=null; SL_root.FindName("C_tooltip").Visibility = "Collapsed";', ms)
}

// Other events

function SL_LockClick(sender, args) {
  SL_locked = !SL_locked

  var lp_text = SL_root.FindName("C_lock_panel_text")
  if (SL_locked)
    lp_text.Text = "(Click to UNLOCK)"
  else {
    lp_text.Text = " (Click to LOCK) "

    var ss = SL_Host.style
    SL_x_last = ss.posLeft
    SL_y_last = ss.posTop

    SL.width  = 116
    SL.height = 24

    var lp = SL_root.FindName("C_lock_panel")
    lp["Canvas.Left"] = lp["Canvas.Top"] = 0
  }

  SL_CenterLockPanel()

  args.Handled = true
}


var EV_SL_MediaEnded, EV_SL_MediaOpened

function SL_MediaOpened(sender, args) {
  if (EV_SL_MediaOpened && EV_SL_MediaOpened(sender, args))
    return
}

function SL_MediaEnded(sender, args) {
  if (EV_SL_MediaEnded && EV_SL_MediaEnded(sender, args))
    return

  sender.Stop()
  sender.Play()
}

var SL_MC_timerID
var SL_MC_timeout = 10*1000
var EV_SL_Media_MouseEnter

function SL_Media_MouseEnter(sender, args) {
  SL_MC_MouseEnter()

  var mc = SL_root.FindName("C_media_control")
  if (mc.Visibility == "Visible")
    return
  if (EV_SL_Media_MouseEnter && EV_SL_Media_MouseEnter(sender, args))
    return

  SL_MC_video_obj = sender
  SL_MC_Update()

  mc.Visibility = "Visible"

  SL_MC_timerID = setTimeout('SL_MC_timerID=null; SL_root.FindName("C_media_control").Visibility = "Collapsed";', SL_MC_timeout)
}

function SL_MC_MouseEnter(sender, args) {
  if (SL_MC_timerID) {
    clearTimeout(SL_MC_timerID)
    SL_MC_timerID = null
  }

  if (!sender)
    return

  var name = sender.Name
  if (!/^MC_(.+)$/.test(name))
    return

  name = RegExp.$1

switch (name) {
  case "play":
    SL_tooltip_msg_custom = 'Play / Pause'
    break
  case "stop":
    SL_tooltip_msg_custom = 'Stop' + (((use_WMP && WMP.in_use) || (!EQP_dragdrop_target || !EQP_dragdrop_target.is_video || !EQP_dragdrop_target.img_obj_i)) ? '' : ' (click again to hide video)')
    break
  case "forward":
    SL_tooltip_msg_custom = 'Seek forward'
    break
  case "backward":
    SL_tooltip_msg_custom = 'Seek backward'
    break
  case "sound":
    SL_tooltip_msg_custom = 'Mute / Unmute'
    break
}

  if (SL_tooltip_msg_custom)
    SL_Tooltip_Show(SL_tooltip_msg_custom)
}


// Media control

function SL_MC_MouseLeave() {
  SL_MC_MouseEnter()
  SL_MC_timerID = setTimeout('SL_MC_timerID=null; SL_root.FindName("C_media_control").Visibility = "Collapsed";', SL_MC_timeout)
}

var SL_MC_video_obj

function SL_MC_Update() {
  if (use_WMP && WMP.in_use) {
    SL_root.FindName("MC_play").Text  = (WMP.player.playState == 3) ? ";" : "4"
    SL_root.FindName("MC_sound").Text = (WMP.player.settings.mute) ? "U" : "V"
  }
  else {
    SL_root.FindName("MC_play").Text  = (SL_MC_video_obj.CurrentState == "Playing") ? ";" : "4"
    SL_root.FindName("MC_sound").Text = (SL_MC_video_obj.IsMuted) ? "U" : "V"
  }
}

function SL_MC_Play() {
//play=52,4, pause=59,;
  if (use_WMP && WMP.in_use) {
    if (WMP.player.playState == 3) {
//      if (WMP_mask) { SL_root.FindName('content_mask').ImageSource = null; }
      WMP.player.controls.pause()
    }
    else {
//      if (WMP_mask) { SL_root.FindName('content_mask').ImageSource = toFileProtocol(WMP_mask); }
      WMP.player.controls.play()
    }
  }
  else {
    if (SL_MC_video_obj.CurrentState == "Playing")
      SL_MC_video_obj.Pause()
    else
      SL_MC_video_obj.Play()
  }

  setTimeout('SL_MC_Update()', 0)
}

function SL_MC_Stop() {
  if (use_WMP && WMP.in_use)
    WMP.player.controls.stop()
  else {
    SL_MC_video_obj.Stop()

    if (SL_MC_video_obj.CurrentState == "Stopped") {
      EQP_Hide_Video()
      return
    }
  }

  setTimeout('SL_MC_Update()', 0)
}

function SL_MC_Forward() {
  SL_MC_Seek(1)
}

function SL_MC_Backward() {
  SL_MC_Seek(-1)
}

function SL_MC_Seek(mod) {
  if (use_WMP && WMP.in_use) {
    try {
      WMP.player.controls.currentPosition += 30 * mod
    }
    catch (err) {
      DEBUG_show('(media seek failed)', 2)
    }
    return
  }

  if (!SL_MC_video_obj.CanSeek || (SL_MC_video_obj.CurrentState == "Stopped"))
    return

  var s = parseInt(SL_MC_video_obj.Position.Seconds) + 30 * mod
  if ((s < 0) || (s > SL_MC_video_obj.NaturalDuration.Seconds))
    return

  var m = parseInt(s/60)
  var h = parseInt(m/60)
  s = s % 60
  m = m % 60

  var p = h+':'+m+':'+s
  SL_MC_video_obj.Position = p
  DEBUG_show(p, 2)
}

function SL_MC_Sound() {
//sound=85,U, mute=86,V
  if (use_WMP && WMP.in_use)
    WMP.player.settings.mute = !WMP.player.settings.mute
  else {
    if (SL_MC_video_obj.IsMuted) {
      SL_MC_video_obj.IsMuted = false
      SL_MC_video_obj.Volume = 1
    }
    else
      SL_MC_video_obj.IsMuted = true
  }

  setTimeout('SL_MC_Update()', 0)
}


// Misc
function SL_DEBUG_show(msg) {
  if (!SL_loaded || SL_windowless)
    return false

try {
  var c = SL_root.FindName("C_Ldebug")
  var d = SL_root.FindName("Ldebug")
  if (msg || (msg == 0)) {
    d.Text = msg

    var r = SL_root.FindName("R_Ldebug")
    r.Width  = d.ActualWidth  + 6
    r.Height = d.ActualHeight + 6

    c.Visibility = "Visible"
  }
  else
    c.Visibility = "Collapsed"
}
catch (err) {}

  return true
}

// SL media speed control (SEQ)

/*
function SL_Media_SEQ(obj, mp) {
  var seq = obj.SEQ

  var count = seq.count
  if (!count)
    count = 0

  count += seq.speed_min + (EV_usage_float/100 * (seq.speed_max - seq.speed_min))

try {
  var state = mp.CurrentState
  if (count >= 1) {
    var fw = 0
    while (count >= 1) {
      if (count >= 2)
        fw += 0.1

      count -= 1
    }


    if (fw) {
      if (mp.CanSeek) {
        var second = mp.Position.Seconds
if (PC_count_absolute % 10 == 0) {
second += 10
// some fractional second value don't seem to work...
second = parseInt(second)
        var min = parseInt(second / 60)
        var hour = parseInt(min / 60)

        second = second % 60
        min = min % 60

DEBUG_show(hour + ':' + min + ':' + second)
        mp.Position = hour + ':' + min + ':' + second
}
      }
    }


    if (state == "Paused")
      mp.Play()
  }
  else {
    if (mp.CanPause && (state != "Stopped"))
      mp.Pause()
  }
}
catch (err) {}

  seq.count = count - parseInt(count)
}
*/

// END
