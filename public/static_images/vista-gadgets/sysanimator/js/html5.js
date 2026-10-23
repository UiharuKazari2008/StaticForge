// HTML5 - Canvas (v1.0.0)

var use_HTML5

// For Silverlight compatibility
var SL_loaded

var SL_windowless = true

var SL_PP_is_reset = true
var SL_PP_enabled

var SL_ST_enabled
// END


var CANVAS_obj = {}

function CANVAS_Object(img_id, ps) {
  this.img_id = img_id
  CANVAS_obj[img_id] = this

  var d
  d = this.canvas = document.createElement("canvas")
  d.id = "CANVAS_" + img_id
  d.img_id = img_id
//d.style.display="none"
/*
d.style.position="absolute"
d.style.posLeft=d.style.posTop=0
document.body.appendChild(d)
*/

  d.canvas_parent = this
  d.Opacity = 1
  d.x_resized = d.y_resized = 0

// getter and setter work only on DOM objects (IE9 beta)
  Object.defineProperty(d, "Source", {
		set: function(src) {
if (!this.img_obj) {
  this.img_obj = new Image()
  this.img_obj.img_id = this.img_id
}
var img_obj = this.img_obj
img_obj.onload = CANVAS_SL_img_onload
img_obj.src = src
		}
	}
  )

  if (ps) {
    this.ps = ps

    if (ps.static_part && (ps.o_min == 100)) {
      var z = ps.z
      if ((z == 0) || !EQP_ps[z-1].use_HTML5 || EQP_ps[z-1].use_raw_pixels)
        ps.use_raw_pixels = true
    }
ps.use_raw_pixels = false
  }
}

function CANVAS_draw(first_draw) {
  if (!SL_loaded || !this.img_loaded || !SL.width)
    return

  if (first_draw && this.drawn_once)
    return

  this.drawn_once = true

  var canvas = this.canvas

  var ps = this.ps
  canvas.width  = EQP_SL_w
  canvas.height = EQP_SL_h
  var x = ps.x_org - EQP_SL_x
  var y = ps.y_org - EQP_SL_y

  var context = canvas.getContext("2d")
  context.drawImage(canvas.img_obj, x,y)

  context.drawImage(canvas, 0,0,EQP_SL_w,EQP_SL_h, 0,0,SL.width,SL.height)

  var x = parseInt(x * EQP_size_scale)
  var y = parseInt(y * EQP_size_scale)
  canvas.x_resized = x
  canvas.y_resized = y
  var w = Math.ceil(ps.w_org * EQP_size_scale)
  var h = Math.ceil(ps.h_org * EQP_size_scale)

/*
try{
  context.drawImage(canvas, x,y,w,h, 0,0,w,h)
}
catch(err) {DEBUG_show(err.description)}
*/

  var image_data = context.getImageData(x,y, w,h)

// Note that resizing the canvas will always reset the display
  canvas.width  = w
  canvas.height = h
  context.putImageData(image_data, 0,0)
//  image_data = null

  canvas.image_data = (ps.use_raw_pixels) ? context.getImageData(0,0, canvas.width,canvas.height) : null
}

CANVAS_Object.prototype.draw = CANVAS_draw

function CANVAS_Mask(name) {
  var d = new Image()
  d.mask_name = name
  d.draw = CANVAS_draw

  var canvas = document.createElement("canvas")
  d.canvas = canvas
  canvas.canvas_parent = canvas.img_obj = d

  Object.defineProperty(d, "ImageSource", {
		set: function(src) {
this.Mask_src = src
if (!src)
  return

this.onload = CANVAS_Mask_onload
this.src = src
		}
	}
  )

  return d
}

function CANVAS_Mask_onload() {
  this.Mask_src = this.src
  this.img_loaded = true
  CANVAS_must_redraw = true

  var ps = { use_raw_pixels:true }
  if (this.mask_name == 'content_mask') {
    ps.x_org = WMP_left
    ps.y_org = WMP_top
    ps.w_org = WMP_width
    ps.h_org = WMP_height
  }
  this.ps = ps

  this.draw(true)
}


// Silverlight emulation START

var SL_mask = {}

var SL_root = {
   FindName: function (name) {
if (/mask/.test(name)) {
  if (!SL_mask[name])
    SL_mask[name] = CANVAS_Mask(name)
  return SL_mask[name]
}

return {}
   }
}

function CANVAS_SL_img_onload() {
  var d = CANVAS_obj[this.img_id]
  d.img_loaded = true
  d.draw(true)
}

// END


var CANVAS_must_redraw

function HTML5_Init() {
  SL_loaded = true

DEBUG_show('Use HTML5', 2, true)

  var d = document.createElement("div")
  var ds = d.style
  d.id = "SL_Host_Parent"
  ds.position = "absolute"
  ds.posLeft = 0
  ds.posTop = 0
  ds.zIndex = 10
  document.body.appendChild(d)

  var d = document.createElement("div")
  var ds = d.style
  d.id = "SL_Host"
  ds.position = "absolute"
  ds.posLeft = 0
  ds.posTop = 0
  SL_Host_Parent.appendChild(d)

  var d = document.createElement("canvas")
  d.width = d.height = 0
  var ds = d.style
  d.id = "SL"
  ds.position = "absolute"
  ds.posLeft = 0
  ds.posTop = 0
  SL_Host.appendChild(d)

// WMP
if (self.WMP)
  WMP.dragdrop_init()

// Enforce proper resizing
  EQP_resize()
}
