// Mascot options

Mascot_dim_para = [2.5, [340,800], [150,100], [40,30],  [120,60]]; //blush:130,90, 80,30

Mascot_ext = "png"
Mascot_eyes_default = "1.png"
Mascot_blink_random = true

Mascot_init_extra = function () {
  if (self.EQP_EV_init) {
    if (use_EQP && !System.Gadget.docked) {
      EQP_EV_initialized = false
      EQP_EV_init()

      Mascot_default_body = false
      EV_animate_full = EQP_EV_animate_full
    }
    else {
      Mascot_default_body = true
      EV_animate_full = null
    }
  }

  Mascot_HTML_extra = '<img id="Imascot_blush" style="position:absolute; top:' + (90/Mascot_factor) + 'px; left:' + (130/Mascot_factor) + 'px; visibility:hidden" src="' + (toFileProtocol(Settings.f_path + '\\' + Mascot_name_prefix + 'misc\\blush.png')) + '">\n'

  document.onmouseover = function () { Imascot_blush.style.visibility = "inherit" }
  document.onmouseout = function () { Imascot_blush.style.visibility = "hidden" }

  document.body.title = 'Mio: Double-click me to toggle the flashlight effect... ^_^;'
  document.ondblclick = function () {
    use_EQP = !use_EQP

    if (!System.Gadget.docked) {
      DEBUG_show('Flashlight Shirt ' + ((use_EQP)?'ON':'OFF'), 5)
      EV_init()
    }
  }
}

// Misc
var use_EQP = false
