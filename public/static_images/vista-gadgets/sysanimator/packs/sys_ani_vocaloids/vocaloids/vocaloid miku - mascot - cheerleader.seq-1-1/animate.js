// System Animator core START
var EV_init
var EV_height, EV_b_height


var EV_init_initialized

EV_init = function () {
  if (EV_init_initialized)
    return

  EV_init_initialized = true

  EV_height = EV_b_height = 150

  var g, g_dummy, g_dummy_max
  var g_new = []
  var g_source = SEQ_gallery_by_name["source"].gallery

  g = { SEQ_name:"idle", SEQ_fps_ini:10, SEQ_fps_end:10, loop_factor:1, count:0 }
  g.gallery = g_source.slice(0, 4)
  g_new.push(g)

  g = { SEQ_name:"cheerleading", SEQ_fps_ini:2, SEQ_fps_end:25, loop_factor:1, count:0 }
  g.gallery = g_new[0].gallery.concat(g_new[0].gallery, g_new[0].gallery, g_source.slice(4), g_source.slice(1, 4))
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
SEQ_gallery_by_name["cheerleading"]
]}
  ]
}
