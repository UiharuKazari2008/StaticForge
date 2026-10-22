// merry-go-round (v1.4.1)

// SA core START
var EV_init
var EV_width, EV_height
var EV_b_width, EV_b_height
var EV_AnimateFrame, EV_AnimateFrame2
var EV_animate_full, EV_animate_full2
var EV_BG_src
var EV_extra_option_menu, EV_mouseover, EV_mouseout
// END


var MGR_x_inc = 0
var MGR_y_inc = -5
var MGR_x_limit, MGR_y_limit
var MGR_gallery, MGR_gallery_org
var MGR_gallery_index = -1
var MGR_gallery_loop = 1
var MGR_dblclick

var MGR_fps_fixed, MGR_random_BG
Settings_default.MGR_fps_fixed = true
Settings_default.MGR_random_BG = true

var EV_init_initialized

EV_init = function () {
  EV_height = EV_b_height = 260
  EV_width = EV_b_width = (System.Gadget.docked) ? 130 : 260
  w_max = h_max = 130

if (self.EQ_Filter) {
  EQ_Filter.EQP_width  = EV_width
  EQ_Filter.EQP_height = EV_height
}

  var s = Lmain_animation.style
  s.pixelWidth = EV_width
  s.pixelHeight = EV_height
  s.overflow = "hidden"

  if (use_matrix) {
    matrix_x_max_factor = (System.Gadget.docked) ? 0.5 : 1
    matrix_y_max_factor = 1
  }

  if (EV_init_initialized) {
    for (var i = 0; i < filter_objs.length; i++)
      filter_objs[i].init()
    Filter_init()
    return
  }
  EV_init_initialized = true

// Load extra options START
  MGR_fps_fixed = returnBoolean("MGR_fps_fixed")
  MGR_random_BG = returnBoolean("MGR_random_BG")
// END

  if (SEQ_gallery_by_name["zdummy"])
    SEQ_gallery_by_name["zdummy"].loop_factor = 2

  EV_BG_src = ""
  BG_draw_func = BG_AddShadow

  MGR_dblclick = document.ondblclick = function () {
    if (MGR_random_BG) {
      if (++MGR_OP_index >= MGR_gallery.length)
        MGR_OP_index = 0

      MGR_gallery_index = -1
      MGR_BG_Check(MGR_OP_sorting)
    }
    else {
      if (++MGR_gallery_index >= MGR_gallery.length)
        MGR_gallery_index = 0

      System.Gadget.Settings.writeString("MGR_gallery_index", MGR_gallery_index)
    }

    var pic = MGR_gallery[MGR_gallery_index]
    document.getElementById("IMGR").src = pic.path_file
    MGR_BG_Reset()

    DEBUG_show((pic.index+1) + '/' + MGR_gallery.length, 1)
  }

  if (MGR_fps_fixed) {
    filter_fps_fixed = true
    EV_animate_full2 = MGR_Animate
  }
  else
    EV_AnimateFrame2 = MGR_Animate

  MGR_gallery_org = Shell_ReturnItemsFromFolder(Settings.f_path + '\\bg')
  MGR_gallery = MGR_gallery_org.slice(0)
  if (!MGR_random_BG) {
    var g_index = System.Gadget.Settings.readString("MGR_gallery_index")
    MGR_gallery_index = (g_index) ? parseInt(g_index) : 0
    if (MGR_gallery_index >= MGR_gallery.length)
      MGR_gallery_index = 0
  }

  var img = document.createElement("img")
  img.id = "IMGR"

  MGR_BG_Check()
  img.src = MGR_gallery[MGR_gallery_index].path_file

  var s = img.style
  s.position = "absolute"
  Lmain_animation.appendChild(img)

  MGR_BG_Reset()

// extra options
  EV_extra_option_menu =
  '<div id="LMGR_random_BG" class="Filter_option" style="position:absolute; top:135px; left: 5px; width:100px;" onclick="MGR_random_BG_toggle()" title="Turn random BG on/off."></div>\n'
+ '<div id="LMGR_fps_fixed" class="Filter_option" style="position:absolute; top:160px; left: 5px; width:100px;" onclick="MGR_fps_fixed_toggle()" title="Turn it OFF for smoother animation when the scroll speed is fast, at the expense of extra CPU usage."></div>\n'

  EV_mouseover = function () {
    LMGR_random_BG.innerHTML = 'Random BG: ' + ((MGR_random_BG) ? 'ON' : 'OFF')
    LMGR_random_BG.style.visibility = "inherit"

    LMGR_fps_fixed.innerHTML = 'Fixed FPS: ' + ((MGR_fps_fixed) ? 'ON' : 'OFF')
    LMGR_fps_fixed.style.visibility = "inherit"
  }

  EV_mouseout = function () {
    LMGR_random_BG.style.visibility = "hidden"
    LMGR_fps_fixed.style.visibility = "hidden"
  }

  Filter_init()
}

function returnYesNo(name, b) {
  var d = Settings_default[name]
  var non_default = "non_default" //(d) ? "no" : "yes"

  return ((!b == d) ? non_default : "")
}

function MGR_fps_fixed_toggle() {
  MGR_fps_fixed = !MGR_fps_fixed
  System.Gadget.Settings.writeString("MGR_fps_fixed", returnYesNo("MGR_fps_fixed", MGR_fps_fixed))

  setTimeout('self.location.href = self.location.href', 0)
}

function MGR_random_BG_toggle() {
  MGR_random_BG = !MGR_random_BG
  System.Gadget.Settings.writeString("MGR_random_BG", returnYesNo("MGR_random_BG", MGR_random_BG))

  if (MGR_random_BG)
    MGR_OP_index = MGR_gallery_index - 1
  else {
    MGR_gallery_index = MGR_gallery[MGR_gallery_index].index - 1
    MGR_gallery = MGR_gallery_org.slice(0)
  }
  MGR_dblclick()

  EV_mouseover()
}

var MGR_OP_index = -1

function MGR_OP_sorting(a, b) {
  if (a.index == MGR_OP_index)
    return -1
  if (b.index == MGR_OP_index)
    return 1

  return Math.random() - 0.5
}

function MGR_BG_Reset() {
  var pic = MGR_gallery[MGR_gallery_index]
  if (!pic.w && !pic.h) {
    var dim = loadImageDim(pic.path)
    pic.w = dim.w
    pic.h = dim.h
  }
  var w = pic.w
  var h = pic.h

  if (MGR_x_inc)
    MGR_x_limit = w - h
  if (MGR_y_inc)
    MGR_y_limit = h - w

  var s = document.getElementById("IMGR").style
  s.width = "auto"
  s.height = "auto"
//  s.pixelWidth = w
//  s.pixelHeight = h
  s.posLeft = 0
  s.posTop = 0
}

function MGR_BG_Check(sort_func) {
  if (!MGR_random_BG)
    return false
  if ((MGR_gallery_index != -1) && (--MGR_gallery_loop > 0))
    return false

  var index_org = (MGR_gallery_index == -1) ? -1 : MGR_gallery[MGR_gallery_index].index

  if ((MGR_gallery_index >= 0) && (++MGR_gallery_index >= MGR_gallery.length))
    MGR_gallery_index = -1

  if (MGR_gallery_index == -1) {
    if (!sort_func)
      sort_func = random_sorting
    MGR_gallery = MGR_gallery.sort(sort_func)
    MGR_gallery_index = 0
  }

  var pic = MGR_gallery[MGR_gallery_index]
  if (pic.index == index_org)
    return false

  if (!pic.w && !pic.h) {
    var dim = loadImageDim(pic.path)
    pic.w = dim.w
    pic.h = dim.h
  }
  var w = pic.w
  var h = pic.h

  var loop_base = Math.round(4 * (675 / w))
  if (loop_base < 1)
    loop_base = 1
  MGR_gallery_loop = loop_base + random(loop_base+1)

  return true
}

var MGR_x_remainder = 0
var MGR_y_remainder = 0

var MGR_Animate = function (pic, w,h) {
  var x_inc, y_inc
  if (MGR_fps_fixed) {
    var factor = (1 + EV_usage_float/100 * (30-1)) / 10

    x_inc = MGR_x_inc * factor + MGR_x_remainder
    y_inc = MGR_y_inc * factor + MGR_y_remainder

    MGR_x_remainder = x_inc - parseInt(x_inc)
    MGR_y_remainder = y_inc - parseInt(y_inc)
    x_inc = parseInt(x_inc)
    y_inc = parseInt(y_inc)
  }
  else {
    x_inc = MGR_x_inc
    y_inc = MGR_y_inc
  }


  var s = document.getElementById("IMGR").style
  var left = s.posLeft + x_inc
  var top  = s.posTop  + y_inc

  var looped

  var x = Math.abs(left)
  if (x_inc && (x > MGR_x_limit)) {
    looped = true
    left = (x - MGR_x_limit) * ((x_inc > 0) ? 1 : -1)
  }
  var y = Math.abs(top)
  if (y_inc && (y > MGR_y_limit)) {
    looped = true
    top = (y - MGR_y_limit) * ((y_inc > 0) ? 1 : -1)
  }

  s.posLeft = left
  s.posTop  = top

  if (looped && MGR_BG_Check()) {
    document.getElementById("IMGR").src = MGR_gallery[MGR_gallery_index].path_file
    MGR_BG_Reset()
  }

  if (pic)
    return {pic:pic, w:w, h:h}
}


// Filters
var use_all_filters = true


if (xul_mode)
  XPCOM_object["Shell.Application"].folder_scan_depth = 3


// Core
document.write('<script language="JavaScript" src="js_filters/filter_core.js"></scr'+'ipt>')
