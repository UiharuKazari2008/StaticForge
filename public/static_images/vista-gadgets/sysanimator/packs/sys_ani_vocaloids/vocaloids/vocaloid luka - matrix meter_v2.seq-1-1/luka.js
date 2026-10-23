// System Animator core START
var EV_return_SEQ_gallery_percent_name
var EV_b_width, EV_b_height


var Luka_frame_ext = ".png"
var Luka_blink_cache_obj =  new imgCache_Object("Iluka_blink", "Iluka_blink_parent")

var EV_init_initialized2

var Luka_init = function () {
  if (EV_init_initialized2)
    return
  EV_init_initialized2 = true


  if (self.HOD_init) {
    HOD_target_bg = BG
    HOD_target_obj = Lmain_obj
    HOD_target_obj_x_offset = 24
    HOD_target_obj_for_hide = [LCPU_main]

    HOD_init()
  }

  if (self.MT_init) {
    MT_handle_state = function ()
{
  if (MT_x_state == "left")
    MT_y_state = "up"
  else if (MT_x_state == "right")
    MT_y_state = "down"

  MT_x_state = null
}

    MT_cancel = function () {}

    MT_init()
  }

  EV_frame_offsetX = 41
  EV_frame_offsetY = 1
  EV_b_width = 192
  EV_b_height = 192

  L_EV_content2.innerHTML =
  '<div id="Iluka_blink_parent" style="position:absolute; top:0px; left:0px"></div>\n'
+ '<img id="Iluka_talk" style="position:absolute; top:0px; left:0px; visibility:hidden" src="' + (toFileProtocol(Settings.f_path + '\\talk_x81_y114\\1' + Luka_frame_ext)) + '">'

  Lmain_animation.onmouseover = Luka_over
  Lmain_animation.onmouseout = Luka_out

  var g, g_dummy, g_dummy_max
  var g_new = []
  var g_source = SEQ_gallery_by_name["source"].gallery

// 0
  g = { SEQ_name:"Luka idle", SEQ_fps_ini:10, SEQ_fps_end:10, loop_factor:1, count:0 }
  g.gallery = [g_source[0]]
  g_new.push(g)

// 1
  g = {
    SEQ_name:"Open eyes", SEQ_fps_ini:15, SEQ_fps_end:15, loop_factor:1, count:0, loop_absolute:1,
    onfinish:function () { SEQ_gallery_percent_index = -1; SEQ_gallery_percent_name = "mouseover2" }
  }
  g.gallery = g_source.slice(0, 10)
  g_new.push(g)

// 2
  g = {
    SEQ_name:"Close eyes", SEQ_fps_ini:15, SEQ_fps_end:15, loop_factor:1, count:0, loop_absolute:1,
    onfinish:function () { SEQ_gallery_percent_index = -1; SEQ_gallery_percent_name = "idle" }
  }
  g_dummy = []
  var g_dummy2 = g_new[1].gallery
  g_dummy_max = g_dummy2.length-1
  for (var i = g_dummy_max; i >= 0; i--)
    g_dummy.push(g_dummy2[i])
  g.gallery = g_dummy
  g_new.push(g)

// 3
  g = { SEQ_name:"On Luka", SEQ_fps_ini:10, SEQ_fps_end:10, loop_factor:1, count:0 }
  g.gallery = [g_source[9]]
  g_new.push(g)

// 4
  g = {
    SEQ_name:"Active up", SEQ_fps_ini:15, SEQ_fps_end:15, loop_factor:1, count:0, loop_absolute:1,
    onfinish:function () { SEQ_gallery_percent_index = -1; SEQ_gallery_percent_name = "active" }
  }
  g.gallery = g_source.slice(0, 12)
  g_new.push(g)

// 5
  g = {
    SEQ_name:"Active down", SEQ_fps_ini:15, SEQ_fps_end:15, loop_factor:1, count:0, loop_absolute:1,
    onfinish:function () { SEQ_gallery_percent_index = -1; SEQ_gallery_percent_name = "idle" }
  }
  g_dummy = []
  var g_dummy2 = g_new[4].gallery
  g_dummy_max = g_dummy2.length-1
  for (var i = g_dummy_max; i >= 0; i--)
    g_dummy.push(g_dummy2[i])
  g.gallery = g_dummy
  g_new.push(g)

// 6
  g = { SEQ_name:"Luka talking", SEQ_fps_ini:2, SEQ_fps_end:20, loop_factor:1, count:0 }
  g.gallery = [g_source[11]]
  g_new.push(g)

  for (var i = 0; i < g_new.length; i++) {
    var SEQ_sub_obj = g_new[i]
    SEQ_sub_obj.SEQ_index = SEQ_gallery.length
    SEQ_gallery_all.push(SEQ_sub_obj)
    SEQ_gallery.push(SEQ_sub_obj)
    SEQ_gallery_by_name[SEQ_sub_obj.SEQ_name] = SEQ_sub_obj
  }

// custom action gallery
  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[SEQ_gallery_by_name["Active down"]]},
{index:1, SEQ_gallery:[SEQ_gallery_by_name["Active up"]]},
{index:"idle", SEQ_gallery:[SEQ_gallery_by_name["Luka idle"]]},
{index:"active", SEQ_gallery:[SEQ_gallery_by_name["Luka talking"]]},
{index:"mouseover", SEQ_gallery:[SEQ_gallery_by_name["Open eyes"]]},
{index:"mouseover2", SEQ_gallery:[SEQ_gallery_by_name["On Luka"]]},
{index:"mouseout", SEQ_gallery:[SEQ_gallery_by_name["Close eyes"]]}
  ]

}

EV_init2 = Luka_init


EV_return_SEQ_gallery_percent_name = function () {
  if (EV_usage == 0) {
    if (SEQ_gallery_percent_name == "active")
      return null
  }
  else {
    if (/^(active|mouseover2)$/.test(SEQ_gallery_percent_name))
      return "active"
    else
      return null
  }

  return SEQ_gallery_percent_name
}

var Luka_blinking = -1
var Luka_blinking_state
var Luka_talking = -1

EV_AnimateFrame = function (pic, w,h) {
  if ((SEQ_gallery_percent_name == "mouseover2") || (SEQ_gallery_percent_name == "active")) {
    if (Luka_blinking > 0) {
      if (Luka_blinking_state != 2)
        Luka_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\blink_x42_y75\\2' + Luka_frame_ext))
      Luka_blinking_state = 2

      var s = Iluka_blink_parent.style
      s.posLeft = Lmain_animation.style.posLeft + 42
      s.posTop = Lmain_animation.style.posTop + 75

      Luka_blinking = -5
    }
    else if ((self.MT_x_state == "left") || ((Luka_blinking == 0) && (Math.random() < 1/20))) {
      if (Luka_blinking_state != 1)
        Luka_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\blink_x42_y75\\1' + Luka_frame_ext))
      Luka_blinking_state = 1

      var s = Iluka_blink_parent.style
      s.posLeft = Lmain_animation.style.posLeft + 42
      s.posTop = Lmain_animation.style.posTop + 75

      Luka_blinking = (self.MT_x_state == "left") ? 0 : 1
    }
    else {
      if (Luka_blinking < 0)
        Luka_blinking++

      Luka_blink_cache_obj.show(false)
    }
  }
  else
    Luka_blink_cache_obj.show(false)

  if ((SEQ_gallery_percent_name == "active") && (self.MT_y_state != "down")) {
    if (Luka_talking > 0) {
      if (--Luka_talking == 0)
        Luka_talking = (Math.random() < 0.5) ? -1 : -2
    }
    else if (Luka_talking == 0) {
//talk_x81_y114
      var s = Iluka_talk.style
      s.posLeft = Lmain_animation.style.posLeft + 81
      s.posTop = Lmain_animation.style.posTop + 114
      s.visibility = "inherit"
      Luka_talking = (Math.random() < 0.5) ? 1 : ((Math.random() < 0.5) ? -1 : -2)
    }
    else {
      if (Luka_talking < 0)
        Luka_talking++

      Iluka_talk.style.visibility = "hidden"
    }
  }
  else
    Iluka_talk.style.visibility = "hidden"

  return {pic:pic, w:w, h:h}
}

var mouseout_timerID

function Luka_over() {
  if (mouseout_timerID) {
    clearTimeout(mouseout_timerID)
    mouseout_timerID = null
    return
  }
  if (EV_usage > 0)
    return

  SEQ_gallery_index = -1
  SEQ_gallery_percent_index = -1

  if (SEQ_gallery_percent_name == "mouseout")
    SEQ_ani_count_overridden = gallery.length - SEQ_ani_count

  SEQ_gallery_percent_name = "mouseover"
}

function Luka_out() {
  mouseout_timerID = setTimeout("Luka_out2()", 100)
}

function Luka_out2() {
  mouseout_timerID = null
  if (EV_usage > 0)
    return

  SEQ_gallery_index = -1
  SEQ_gallery_percent_index = -1

  if (SEQ_gallery_percent_name == "mouseover")
    SEQ_ani_count_overridden = gallery.length - SEQ_ani_count

  SEQ_gallery_percent_name = "mouseout"
}

// Hide Oversized Dock
//document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path) + '/hide_oversized_dock.js"></scr'+'ipt>')

// Mouse tracking
//document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path) + '/mouse_tracking.js"></scr'+'ipt>')
