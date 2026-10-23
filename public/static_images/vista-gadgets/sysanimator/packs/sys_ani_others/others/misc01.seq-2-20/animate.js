// System var
var EV_init
var EV_height, EV_b_height


var EV_initialized

EV_init = function () {
  if (EV_initialized)
    return
  EV_initialized = true

  EV_height = EV_b_height = h_max

  var g, g_dummy, g_dummy_max
  var g_new = []
  var g_source = SEQ_gallery_all[0].gallery

  g = { SEQ_name:"idle", SEQ_fps_ini:30, SEQ_fps_end:30, loop_factor:1, count:0 }
  g.gallery = [g_source[0]]
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
{index:0, SEQ_gallery:[SEQ_gallery_by_name["idle"]]},
{index:1, SEQ_gallery:[
SEQ_gallery_all[0]
]}
  ]
}
