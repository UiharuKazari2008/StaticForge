// Hide Oversized Dock

var Windows7_or_above = /Windows NT [7-9]/i.test(navigator.userAgent)

var HOD_target_bg, HOD_target_obj, HOD_target_obj_x_offset
var HOD_target_obj_for_hide = []
var HOD_target_obj_for_hide_enabled = []

function HOD_init() {
  Seq.item("Mouse Tracking").At(0.1, "document.fireEvent('onclick')", -1, 0.1)
  Seq.item("Mouse Tracking").Play()
  document.onclick = HOD_onclick
}

var HOD_clipped

function HOD_onclick(e) {
  if (!e)
    e = event

  if (self.MT_onclick)
    MT_onclick(e)

// HOD core
  if (Windows7_or_above)
    return
  if (!System.Gadget.docked || (EV_width <= 138))
    return HOD_unclip()

  var x = e.clientX
  var y = e.clientY

  if ((y < 0) || (y > EV_height))
    return HOD_unclip()

  var x_margin = EV_width - 138
  if ((x < 0) || (x >= x_margin))
    return HOD_unclip()

  if (HOD_clipped)
    return
  HOD_clipped = true

  var obj_x_margin = x_margin - HOD_target_obj_x_offset
  HOD_target_obj.style.clip = 'rect(auto auto auto ' + obj_x_margin + 'px)'

  HOD_target_bg.opacity = 0
  if (self.BG_img_objs) {
    for (var i = 0; i < BG_img_objs.length; i++)
      BG_img_objs[i].opacity = 0
  }

  for (var i = 0; i < HOD_target_obj_for_hide.length; i++) {
    var s = HOD_target_obj_for_hide[i].style

    HOD_target_obj_for_hide_enabled[i] = (s.visibility != "hidden")
    if (HOD_target_obj_for_hide_enabled[i])
      s.visibility = "hidden"
  }
}

function HOD_unclip() {
  if (!HOD_clipped)
    return null
  HOD_clipped = false

  HOD_target_obj.style.clip = 'rect(auto auto auto auro)'

  HOD_target_bg.opacity = 100
  if (self.BG_img_objs) {
    for (var i = 0; i < BG_img_objs.length; i++)
      BG_img_objs[i].opacity = 100
  }

  for (var i = 0; i < HOD_target_obj_for_hide.length; i++) {
    if (HOD_target_obj_for_hide_enabled[i])
      HOD_target_obj_for_hide[i].style.visibility = "inherit"
  }

  return null
}
