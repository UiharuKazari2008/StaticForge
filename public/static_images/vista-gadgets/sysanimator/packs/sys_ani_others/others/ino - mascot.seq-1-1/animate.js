// System Animator core START
var EV_init


var EV_init_initialized

EV_init = function () {
  if (EV_init_initialized)
    return

  EV_init_initialized = true

// custom action gallery
  SEQ_gallery_by_percent = [
{index:0, SEQ_gallery:[
SEQ_gallery_by_name["idle01"],
SEQ_gallery_by_name["idle02"]
]},
{index:1, SEQ_gallery:[
SEQ_gallery_by_name["crouch"],
SEQ_gallery_by_name["stance"],
SEQ_gallery_by_name["hat"],
SEQ_gallery_by_name["swing"],
SEQ_gallery_by_name["kiss"],
SEQ_gallery_by_name["power_rock"],
SEQ_gallery_by_name["guitar_smash"],
SEQ_gallery_by_name["rock01"],
SEQ_gallery_by_name["rock02"]
]}
  ]
}
