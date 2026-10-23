// PNG AA version

// System Animator core START
var EV_init, EV_init_initialized
var EV_AnimateFrame

use_native_img = true

var Miku_blink_cache_obj = new imgCache_Object("Imiku_blink", "Imiku_blink_parent")

EV_init = function () {
  image_ratio = 1

  if (EV_init_initialized)
    return

  EV_init_initialized = true

  L_EV_content.style.zIndex = 99
  L_EV_content.innerHTML =
  '<div id="Imiku_blink_parent" style="position:absolute; top:0px; left:0px"></div>'

// custom action gallery
  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[SEQ_gallery_by_name["idle"]]},
{index:1, SEQ_gallery:[SEQ_gallery_by_name["dancing"]]}
  ]
}

var Miku_blinking

EV_AnimateFrame = function (pic, w,h) {
  if (SEQ_gallery_percent_index == 0) {
    var f = pic.frame
    if ((f == 8) && (Math.random() < 0.4)) {
      Miku_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\blink\\1.png'))
      var s = Imiku_blink_parent.style
      s.posLeft = img_obj.style.posLeft + 56
      s.posTop = img_obj.style.posTop + 26

      Miku_blinking = true
    }
    else if ((f == 1) && Miku_blinking) {
      Miku_blink_cache_obj.load(toFileProtocol(Settings.f_path + '\\blink\\2.png'))

      Miku_blinking = false
    }
    else
      Miku_blink_cache_obj.show(false)
  }
  else
    Miku_blink_cache_obj.show(false)

  return {pic:pic, w:w, h:h}
}