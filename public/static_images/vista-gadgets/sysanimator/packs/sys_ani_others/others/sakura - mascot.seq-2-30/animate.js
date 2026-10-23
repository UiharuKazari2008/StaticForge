// System Animator core START
var EV_init


var EV_init_initialized

EV_init = function () {
  if (EV_init_initialized)
    return

  EV_init_initialized = true

  SEQ_gallery_by_name["dance"].loop_factor = 2

// custom action gallery
  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[SEQ_gallery_by_name["idle"]]},
{index:1, SEQ_gallery:[
SEQ_gallery_by_name["dance"],
SEQ_gallery_by_name["shout"],
SEQ_gallery_by_name["high_kick"],
SEQ_gallery_by_name["spin_kick"],
SEQ_gallery_by_name["shouryuken"]
]}
  ]
}
