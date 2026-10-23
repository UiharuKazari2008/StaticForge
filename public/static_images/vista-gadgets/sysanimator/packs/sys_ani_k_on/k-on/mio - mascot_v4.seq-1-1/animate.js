// Desktop Mascot (v1.6.1)

// System Animator core START
var EV_init, EV_init_initialized
var EV_width, EV_height
var EV_b_width, EV_b_height
var EV_AnimateFrame
var EV_BG_src
var EV_return_SEQ_gallery_percent_name

var Mascot_factor
var Mascot_name_prefix
var Mascot_dim_para
var Mascot_ext
var Mascot_eyes_default
var Mascot_blink_random

var Mascot_HTML_extra
var Mascot_init_extra

var Mascot_default_body = true

var Mascot_blink_cache_obj = new imgCache_Object("Imascot_blink", "Imascot_blink_parent")

var Mascot_init = function () {
  Mascot_factor = (System.Gadget.docked) ? Mascot_dim_para[0] : 1

  var ww = Mascot_dim_para[1][0]
  var hh = Mascot_dim_para[1][1]
  EV_width = ww / Mascot_factor
  EV_height = hh / Mascot_factor
  EV_frame_offsetX = Mascot_dim_para[2][0] / Mascot_factor
  EV_frame_offsetY = Mascot_dim_para[2][1] / Mascot_factor
  EV_b_width = Mascot_dim_para[3][0] / Mascot_factor
  EV_b_height = Mascot_dim_para[3][1] / Mascot_factor

  var blink_x, blink_y
  if (Mascot_dim_para[4]) {
    blink_x = Mascot_dim_para[4][0] / Mascot_factor
    blink_y = Mascot_dim_para[4][1] / Mascot_factor
  }
  else {
    blink_x = EV_frame_offsetX
    blink_y = EV_frame_offsetY
  }

  if (!Mascot_ext)
    Mascot_ext = "gif"
  Mascot_name_prefix = Mascot_ext + "_" + ((System.Gadget.docked) ? "docked" : "undocked") + "_"


// Main
  BG.removeObjects()

// INIT extras START
  if (Mascot_init_extra)
    Mascot_init_extra()
// END

if (Mascot_default_body) {
  var Mascot_BG = BG.addImageObject(Settings.f_path + '\\images\\bg.png' , 0,0)
  Mascot_BG.width = EV_width
  Mascot_BG.height = EV_height
  Mascot_BG.left = (EV_width - ww) / 2
  Mascot_BG.top = (EV_height - hh) / 2
}


  Settings.HandleOversize = "crop"

  L_EV_content2.innerHTML =
  '<div id="Imascot_blink_parent" style="position:absolute; top:' + blink_y + 'px; left:' + blink_x + 'px"></div>\n'
+ ((Mascot_HTML_extra) ? Mascot_HTML_extra : '')

  Mascot_blink_cache_obj.clear()

// custom action gallery
//  Re-initialize on every resize to make sure that the correct gallery is loaded
  SEQ_gallery_index = -1
  SEQ_gallery_percent_index = -1

  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[SEQ_gallery_by_name[Mascot_name_prefix+"idle"]]},
{index:1, SEQ_gallery:[SEQ_gallery_by_name[Mascot_name_prefix+"singing"]]}
  ]

  if (self.MT_init) {
/*
    MT_handle_state = function ()
{
  if (MT_x_state == "right")
    MT_y_state = "up"
  else if (MT_x_state == "left")
    MT_y_state = "down"

  MT_x_state = null

  MT_handle_state_DEFAULT()
}

    SEQ_gallery_by_percent.push({index:"mouse down", SEQ_gallery:SEQ_gallery_by_percent[0].SEQ_gallery})
    SEQ_gallery_by_percent.push({index:"mouse up", SEQ_gallery:SEQ_gallery_by_percent[1].SEQ_gallery})
*/
  }


// others
  if (EV_init_initialized)
    return
  EV_init_initialized = true

  if (self.MT_init)
    MT_init()
}

EV_init = Mascot_init


EV_return_SEQ_gallery_percent_name = function () {
  if (EV_usage == 0)
    return null

  return SEQ_gallery_percent_name
}


var Mascot_blinking = -1
var Mascot_blinking_state

var Mascot_AnimateFrame = function (pic, w,h) {
  if ((self.MT_x_state == "left") || (Mascot_blinking > 0)) {
    if (Mascot_blinking_state != 2)
      Mascot_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\' + Mascot_name_prefix + 'blink\\2.' + Mascot_ext))
    Mascot_blinking_state = 2

    Mascot_blinking = -5
  }
  else if ((Mascot_blinking == 0) && (Math.random() < 1/20)) {
    if (Mascot_blinking_state != 1)
      Mascot_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\' + Mascot_name_prefix + 'blink\\1.' + Mascot_ext))
    Mascot_blinking_state = 1

    Mascot_blinking = 1
  }
  else {
    if (Mascot_blinking < 0)
      Mascot_blinking++

    if (Mascot_eyes_default)
      Mascot_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\' + Mascot_name_prefix + 'blink\\' + Mascot_eyes_default))
    else
      Mascot_blink_cache_obj.show(false)
  }

  if (Mascot_blink_random && (SEQ_gallery_percent_index > 0)) {
    var g = SEQ_gallery_by_name[Mascot_name_prefix+"singing"].gallery
    pic = g[random(g.length)]
  }

  return {pic:pic, w:w, h:h}
}

EV_AnimateFrame = Mascot_AnimateFrame


document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path) + '/mascot_options.js"></scr'+'ipt>')


// EQP extras
document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path) + '/EQP_extras.js"></scr'+'ipt>')


// Mouse tracking
//document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path) + '/mouse_tracking.js"></scr'+'ipt>')
