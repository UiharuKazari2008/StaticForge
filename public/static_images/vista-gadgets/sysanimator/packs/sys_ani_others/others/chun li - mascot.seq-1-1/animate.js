// System Animator core START
var EV_init


var EV_init_initialized

EV_init = function () {
  if (EV_init_initialized)
    return

  EV_init_initialized = true

  var g = SEQ_gallery_by_name["bird_kick"].gallery
  var birdkick_start = g.slice(0, 11)
  var birdkick_spin = g.slice(11, 19)
  var birdkick_end = g.slice(19, 40)

  var g_temp = []
  for (var i = 0; i < 15; i++)
    g_temp = g_temp.concat(birdkick_spin)
  birdkick_spin = g_temp

  SEQ_gallery_by_name["bird_kick"].gallery = birdkick_start.concat(birdkick_spin, birdkick_end)

// custom action gallery
  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[SEQ_gallery_by_name["idle"]]},
{index:1, SEQ_gallery:[
SEQ_gallery_by_name["high_kick"],
SEQ_gallery_by_name["happy_jump"],
SEQ_gallery_by_name["happy_pose"],
SEQ_gallery_by_name["bird_kick"],
SEQ_gallery_by_name["fast_kick"],
SEQ_gallery_by_name["kung_fu"]
]}
  ]
}
