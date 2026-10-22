// System Animator core START
var EV_init, EV_init_initialized
var EV_height, EV_b_height


EV_init = function () {
  if (EV_init_initialized)
    return

  EV_init_initialized = true

  if (Settings.Display <= 0) {
    L_EV_content.style.zIndex = 99
    L_EV_content.innerHTML = '<div style="position:absolute; top:' + (h_max-1) + 'px; left:0px; height:1px; width:' + w_max + '; background-color:black"></div>'
  }

  EV_height = EV_b_height = h_max

  var g, g_dummy, g_dummy_max
  var g_new = []
  var g_source = SEQ_gallery_by_name["source"].gallery

  g = { SEQ_name:"Dance 01", SEQ_fps_ini:2, SEQ_fps_end:25, loop_factor:1, count:0 }
  g.gallery = g_source.slice(2, 35)
  g_new.push(g)

  g = { SEQ_name:"Dance 02", SEQ_fps_ini:2, SEQ_fps_end:25, loop_factor:1, count:0 }
  g_dummy = g_source.slice(35, 57)
  g_dummy_max = g_dummy.length - 2
  for (var i = g_dummy_max; i >= 1; i--)
    g_dummy.push(g_dummy[i])
  g.gallery = g_dummy
  g_new.push(g)

  g = { SEQ_name:"Dance full", SEQ_fps_ini:2, SEQ_fps_end:25, loop_factor:1, count:0 }
  g.gallery = g_new[0].gallery.concat(g_new[1].gallery, g_new[1].gallery[0]) //, g_source.slice(0, 2)
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
SEQ_gallery_by_name["Dance full"],
SEQ_gallery_by_name["Dance 01"],
SEQ_gallery_by_name["Dance 02"]
]}
  ]

}
