// Mouse tracking (v1.1)

var MT_enabled
var MT_mouseX = -9999
var MT_mouseY = -9999
var MT_x_idle_range = 100
var MT_y_idle_range = 100
var MT_x_state, MT_y_state

var MT_handle_state_DEFAULT = function () {
  if (EV_usage == 0)
    return

  if (MT_y_state == "up") {
    if (SEQ_gallery_percent_name != "mouse up") {
      SEQ_gallery_percent_index = -1
      SEQ_gallery_percent_name = "mouse up"
    }
  }
  else if (MT_y_state == "down") {
    if (SEQ_gallery_percent_name != "mouse down") {
      SEQ_gallery_percent_index = -1
      SEQ_gallery_percent_name = "mouse down"
    }
  }
}

var MT_handle_state = MT_handle_state_DEFAULT

var MT_cancel = function () {
  SEQ_gallery_percent_index = -1
  SEQ_gallery_percent_name = null
}

function MT_ondblclick() {
  if (MT_enabled) {
    MT_enabled = false
    MT_x_state = MT_y_state = null
    MT_cancel()
  }
  else
    MT_enabled = true

  DEBUG_show(((MT_enabled) ? 'Mouse Tracking ON' : 'Mouse Tracking OFF'), 2)
}

function MT_init() {
  document.ondblclick = MT_ondblclick

  if (Seq.item("Mouse Tracking").initialized)
    return

  Seq.item("Mouse Tracking").At(0.1, "document.fireEvent('onclick')", -1, 0.1)
  Seq.item("Mouse Tracking").Play()
  document.onclick = MT_onclick
}

function MT_onclick(e) {
  if (!MT_enabled)
    return

  if (!e)
    e = event

  var x = e.clientX
  var y = e.clientY

  if (MT_mouseX == -9999) {
    MT_mouseX = x
    MT_mouseY = y
    return
  }

  var x_dis = x - MT_mouseX
  var y_dis = y - MT_mouseY

  if (Math.abs(x_dis) > MT_x_idle_range)
    MT_x_state = (x_dis > 0) ? "right" : "left"
  if (Math.abs(y_dis) > MT_y_idle_range)
    MT_y_state = (y_dis > 0) ? "down" : "up"

  MT_handle_state()

  MT_mouseX = x
  MT_mouseY = y
}
