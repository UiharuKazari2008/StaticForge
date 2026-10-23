// EQP Gallery (v1.6.6)

//  SA defaults
var EV_init
var EV_width, EV_height
var EV_BG_src, EV_BG_allow_dummy
var EV_animate_full

var use_full_spectrum = true
// END


var EQP_ps
var EQP_EQ_mode, EQP_EQ_index
var EQP_decay_factor
var EQP_decay_factor2
var EQP_EQ_min = 99
var EQP_EQ_max = 0
var EQP_init_extra, EQP_animate_extra
var EQP_allow_resize
var EQP_size_scale = 1
var EQP_size_scale_auto = true

var EQP_FB_EQ
var EQP_FB_rotation, EQP_FB_flipH, EQP_FB_flipV

var EQP_FB_align_center
var EQP_FB_align_center_shift
var EQP_gallery_obj = []
var EQP_gallery_obj_active
var EQP_EQ_divider
var EQP_EQ_width, EQP_EQ_height
var EQP_bg_color
var EQP_bg_filter
var EQP_bg_border, EQP_border_width
var EQP_u_reversed
var EQP_dragdrop_obj


function EQP_resize(scale, no_msg) {
  EQP_resize_CORE(scale, no_msg)


  var scale_org = EQP_size_scale
  if (use_Silverlight && SL_ST_enabled)
    EQP_size_scale = 1


/*
  if (EQP_gallery_obj_active.bg_container) {
DEBUG_show("(IMG recreated)",2)
    EQP_gallery_obj_active.bg_container.removeNode(true)
    EQP_gallery_obj_active.bg_container = null
  }
  if (EQP_gallery_obj_active.main_container) {
    EQP_gallery_obj_active.main_container.removeNode(true)
    EQP_gallery_obj_active.main_container = null
  }
*/

  var bg = EQP_gallery_obj_active.bg
  bg.x = bg.x_org * EQP_size_scale + EQP_border_width
  bg.y = bg.y_org * EQP_size_scale + EQP_border_width
  bg.w = bg.w_org * EQP_size_scale
  bg.h = bg.h_org * EQP_size_scale


  var img_new = false
  var bg_c = EQP_gallery_obj_active.bg_container
  if (!bg_c) {
    img_new = true
    bg_c = document.createElement("div")
    bg_c.style.position = "absolute"
    bg_c.style.posLeft = 0
    bg_c.style.posTop = 0
  }

if (use_Silverlight) {
  if (SL_loaded) {
    var ps = EQP_ps[0]

var img = ps.img_obj
if (!img) {
  var tag
  if (bg.is_video)
    tag = 'Canvas'
  else
    tag = 'Image'

  var clip =
  '<'+tag+'.Clip>\n'
+ '<PathGeometry>\n'
+ '<PathGeometry.Figures>\n'
+ '<PathFigure x:Name="bg_StartPoint" StartPoint="0,0">\n'
+ '<PathFigure.Segments>\n'
+ '<PolyLineSegment x:Name="bg_Points" Points="0,0, 0,0, 0,0" />\n'
+ '</PathFigure.Segments>\n'
+ '</PathFigure>\n'
+ '</PathGeometry.Figures>\n'
+ '</PathGeometry>\n'
+ '</'+tag+'.Clip>\n'

  var opacity = (bg.opacity == null) ? '' : ' Opacity="' + (bg.opacity/100) + '"';

  var xaml
  if (bg.is_video) {
    xaml =
  '<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="bg" '
+ 'Canvas.ZIndex="50"' + opacity
+ '>\n'
+ clip
+ '<MediaElement x:Name="bg_obj" '
+ 'Stretch="UniformToFill" Source="' + toFileProtocol(bg.src) + '" '
+ 'MediaOpened="SL_MediaOpened" MediaEnded="SL_MediaEnded" '
+ ((bg.use_media_control) ? 'MouseEnter="SL_Media_MouseEnter" ' : '')
+ ((bg.play_sound) ? 'Volume="1"' : 'IsMuted="true"')
+ '>\n'
+ '</MediaElement>\n'
+ '</Canvas>'
  }
  else if (bg.is_filter) {
    xaml =
  '<Image xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="bg" '
+ 'Canvas.ZIndex="50" Opacity="0.5" Stretch="Fill" Source="' + toFileProtocol(System.Gadget.path + '\\images\\bars_bg0.png') + '">\n'
+ clip
+ '</Image>'
  }
  else {
    xaml =
  '<Image xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="bg" '
+ 'Canvas.ZIndex="50"' + opacity + ' Source="' + toFileProtocol(bg.src) + '">\n'
+ clip
+ '</Image>'
  }

  SL_content.children.add(SL.content.createFromXaml(xaml, false));
  img = ps.img_obj = SL_root.FindName("bg")
}

    if (bg.w >= 0)
      img.Width  = bg.w
    if (bg.h >= 0)
      img.Height = bg.h
    img["Canvas.Left"] = (bg.x_org - EQP_gallery_obj_active.x_offset) * EQP_size_scale
    img["Canvas.Top"] = (bg.y_org - EQP_gallery_obj_active.y_offset) * EQP_size_scale

    if (bg.is_video) {
      var bg_v = SL_root.FindName("bg_obj")
      if (bg.w_video > 0)
        bg_v.Width  = bg.w_video
      if (bg.h_video > 0)
        bg_v.Height = bg.h_video
    }

    for (var i = 0; i < EQP_ps.length; i++)
      EQP_ps[i].o_last = -1
  }
}
else {
  for (var i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]

    var img = ps.img_obj
    if (img_new) {
      img = ps.img_obj = document.createElement("img")
      img.style.position = "absolute"
      ps.o_last = -1
    }
//    img.style.pixelWidth = bg.w
//    img.style.pixelHeight = bg.h
    img.style.width = "auto"
    img.style.height = "auto"
    img.style.posLeft = bg.x
    img.style.posTop = bg.y
    img.src = ((EQP_size_scale < 1) || EQP_gallery_obj_active.use_gimage) ? "gimage:///" + bg.src + ("?width=" + bg.w + "&height=" + bg.h) : toFileProtocol(bg.src)

    if (img_new)
      bg_c.appendChild(img)
  }
//DEBUG_show(EQP_ps[0].img_obj.src)
}


  var img_new = false
  var main_c = EQP_gallery_obj_active.main_container
  if (!main_c) {
    img_new = true
    main_c = document.createElement("div")
    main_c.style.position = "absolute"
    main_c.style.posLeft = 0
    main_c.style.posTop = 0
  }

  var imgs = EQP_gallery_obj_active.imgs
  for (var i = 0; i < imgs.length; i++) {
    var _img = imgs[i]

    _img.x = _img.x_org * EQP_size_scale + EQP_border_width
    _img.y = _img.y_org * EQP_size_scale + EQP_border_width
    _img.w = _img.w_org * EQP_size_scale
    _img.h = _img.h_org * EQP_size_scale

    var img = _img.img_obj

if (_img.use_GADGET_IMG) {
  if (!img)
    img = _img.img_obj = BG.addImageObject(_img.src, 0,0)
  img.left = (_img.w - _img.w_org)/2 + _img.x
  img.top  = (_img.h - _img.h_org)/2 + _img.y
  img.width  = _img.w
  img.height = _img.h
  continue
}

if (use_Silverlight && !EQP_gallery_obj_active.use_filter) {
  if (SL_loaded) {
    if (!img) {
      var img_id = "main" + i

      var xaml_para = 'Canvas.ZIndex="' + _img.z + '"' + ((_img.opacity == null) ? '' : ' Opacity="' + (_img.opacity/100) + '"');

      var xaml, ext
      if (_img.is_video) {
        xaml =
  '<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + 'v" '
+ xaml_para
+ '>\n'
+ '<MediaElement x:Name="' + img_id + 'v_obj" '
+ 'Stretch="UniformToFill" Source="' + toFileProtocol(_img.src) + '" '
+ 'MediaOpened="SL_MediaOpened" MediaEnded="SL_MediaEnded" '
+ ((_img.use_media_control) ? 'MouseEnter="SL_Media_MouseEnter" ' : '')
+ ((_img.play_sound) ? 'Volume="1"' : 'IsMuted="true"')
+ '>\n'
+ '</MediaElement>\n'
+ '</Canvas>'

        ext = 'v'
      }
      else {
        xaml =
  '<Image xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + 'i" '
+ xaml_para + ' Source="' + toFileProtocol(_img.src) + '"'
+ '>\n'
+ '</Image>'

        ext = 'i'
      }

      SL_content.children.add(SL.content.createFromXaml(xaml, false));
      img = _img.img_obj = _img['img_obj_' + ext] = SL_root.FindName(img_id + ext)
    }

    if (_img.w >= 0)
      img.Width  = _img.w
    if (_img.h >= 0)
      img.Height = _img.h
    img["Canvas.Left"] = (_img.x_org - EQP_gallery_obj_active.x_offset) * EQP_size_scale
    img["Canvas.Top"] = (_img.y_org - EQP_gallery_obj_active.y_offset) * EQP_size_scale

    if (_img.is_video) {
      var img_v = SL_root.FindName(img.Name + "_obj")
      if (_img.w_video > 0)
        img_v.Width  = _img.w_video
      if (_img.h_video > 0)
        img_v.Height = _img.h_video
    }
  }
  continue
}

    if (img_new) {
      img = _img.img_obj = document.createElement("img")
      img.style.position = "absolute"
    }
//    img.style.pixelWidth = _img.w
//    img.style.pixelHeight = _img.h
    img.style.width  = "auto"
    img.style.height = "auto"
    img.style.posLeft = _img.x
    img.style.posTop  = _img.y

    if ((i == 0) && use_Pixastic) {
      var canvas = _img.canvas
      if (!canvas) {
        canvas = _img.canvas = document.createElement("canvas")
        canvas.style.position = "absolute"
        main_c.appendChild(canvas)
      }
      canvas.style.posLeft = _img.x
      canvas.style.posTop  = _img.y

      img.onload = function () {
if (this.drawn)
  return
this.drawn=true

var img = this

var options = {radius:5, density:1.5, noise:1.0, transparent:false}
options.leaveDOM = true
Pixastic.process(img, "pointillize", options);
img = options.resultCanvas

/*
var options = {hue:0,saturation:-100,lightness:0};
options.leaveDOM = true
Pixastic.process(img, "hsl", options);
img = options.resultCanvas

var options = {mono:true, amount:0.5, strength:0.5}
options.leaveDOM = true
Pixastic.process(img, "noise", options);
img = options.resultCanvas
*/

var imgs = EQP_gallery_obj_active.imgs

var canvas = imgs[0].canvas
canvas.width  = img.width
canvas.height = img.height

var context = canvas.getContext("2d")
context.drawImage(img, 0,0)

imgs[0].img_obj.style.display = "none"
      }
    }

    img.src = ((EQP_size_scale < 1) || EQP_gallery_obj_active.use_gimage) ? "gimage:///" + _img.src + ("?width=" + _img.w + "&height=" + _img.h) : toFileProtocol(_img.src)

    if (img_new)
      main_c.appendChild(img)
  }

  if (!use_Pixastic && EQP_gallery_obj_active.use_filter)
    imgs[0].img_obj.style.filter = EQP_bg_filter


  EQP_size_scale = scale_org

  EV_width  = EQP_gallery_obj_active.w = Math.round(EQP_gallery_obj_active.w_org * EQP_size_scale + EQP_border_width*2)
  EV_height = EQP_gallery_obj_active.h = Math.round(EQP_gallery_obj_active.h_org * EQP_size_scale + EQP_border_width*2)

  if (use_Silverlight && SL_loaded) {
    var ss = SL_Host_Parent.style
    var cp = SL_root.FindName("C_content_parent")
    ss.pixelWidth  = cp.Width  = Math.round((EQP_gallery_obj_active.w_org - EQP_gallery_obj_active.x_offset*2) * EQP_size_scale)
    ss.pixelHeight = cp.Height = Math.round((EQP_gallery_obj_active.h_org - EQP_gallery_obj_active.y_offset*2) * EQP_size_scale)
    ss.posLeft = Math.round(EQP_gallery_obj_active.x_offset * EQP_size_scale + EQP_border_width)
    ss.posTop  = Math.round(EQP_gallery_obj_active.y_offset * EQP_size_scale + EQP_border_width)

    SL_ArrangeButtons()

    if (SL_ST_enabled) {
      var st = SL_root.FindName("content_ST")
      st.ScaleX = st.ScaleY = EQP_size_scale * SL_fullscreen_scale
    }
  }

  if (EQP_bg_color) {
    var s = EQP_gallery_obj_active.html_bg.style
    s.pixelWidth = EV_width
    s.pixelHeight = EV_height
  }

  if (!EQP_gallery_obj_active.main_container) {
    EQP_gallery_obj_active.main_container = main_c
    L_EV_content.appendChild(main_c)
  }
  if (!EQP_gallery_obj_active.bg_container) {
    EQP_gallery_obj_active.bg_container = bg_c
    L_EV_content.appendChild(bg_c)
  }
}


function EQP_FB_AdjustRotation() {
  if (EQP_FB_rotation == null)
    EQP_FB_rotation = 0

  if (EQP_FB_rotation == 180) {
    EQP_FB_rotation = 0
    EQP_FB_flipV = !EQP_FB_flipV
    EQP_FB_flipH = !EQP_FB_flipH
 }
  else if (EQP_FB_rotation == 270) {
    EQP_FB_rotation = 90
    EQP_FB_flipV = !EQP_FB_flipV
    EQP_FB_flipH = !EQP_FB_flipH
  }

  if (returnBoolean("ReverseAnimation")) {
    if (EQP_FB_rotation == 0)
      EQP_FB_flipV = !EQP_FB_flipV
    else
      EQP_FB_flipH = !EQP_FB_flipH
  }
}


var EQP_EV_initialized

var EQP_EV_init = function () {
  if (EQP_EV_initialized) {
    if (EQP_allow_resize)
      EQP_resize()

    return
  }
  EQP_EV_initialized = true


// Defaults
  var size_default = (System.Gadget.docked) ? 0.5 : 1
  EQP_size_scale = parseFloat(LABEL_LoadSettings("LABEL_EQP_size_scale", size_default))
  if (EQP_size_scale != size_default)
    EQP_size_scale_default = EQP_size_scale

  if (EQP_EQ_mode == null)
    EQP_EQ_mode = true

  EV_BG_allow_dummy = true

  if (EQP_decay_factor == null)
    EQP_decay_factor = 1
  if (EQP_decay_factor2 == null)
    EQP_decay_factor2 = 0.2

  if (EQP_EQ_index == null)
    EQP_EQ_index = 0
  if (EQP_EQ_divider == null)
    EQP_EQ_divider = 14
  if (EQP_allow_resize == null)
    EQP_allow_resize = true

  if (EQP_FB_align_center_shift == null)
    EQP_FB_align_center_shift = 0.5

  EQP_FB_AdjustRotation()

  if (EQP_FB_EQ == null) {
    var divider = EQP_EQ_divider
    if (divider == 7)
      EQP_FB_EQ = [[1,2],[3,4],[5,6],[7,8],[9,10],[11,12],[13,14]]
    else if (divider == 14)
      EQP_FB_EQ = [[1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12],[13],[14]]
    else {
      var EQ = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]

      EQP_FB_EQ = []
      for (var i = 0; i < divider; i++) {
        var mod = 16/divider
        EQP_FB_EQ.push(EQ.slice(Math.round(mod*i), Math.round(mod*(i+1))))
      }
//setTimeout('DEBUG_show(EQP_FB_EQ.join("|"))', 1000)
    }
  }

  if (EQP_bg_filter == null)
    EQP_bg_filter = 'progid:DXImageTransform.Microsoft.BasicImage(grayScale=1, opacity=0.5)'
  if (EQP_bg_border == null)
    EQP_bg_border = '2px outset white'

  if (EQP_EQ_width) {
    var w = 0
    var flipped = (EQP_FB_rotation == 0) ? EQP_FB_flipH : EQP_FB_flipV
    var _EQ_width = EQP_EQ_width.slice(0)
    for (var i = 0; i < EQP_EQ_width.length; i++) {
      w += _EQ_width[((flipped) ? _EQ_width.length-i-1 : i)]
      EQP_EQ_width[i] = w
    }
  }
  if (EQP_EQ_height) {
    var h = 0
    var flipped = (EQP_FB_rotation == 0) ? EQP_FB_flipV : EQP_FB_flipH
    var _EQ_height = EQP_EQ_height.slice(0)
    for (var i = 0; i < EQP_EQ_height.length; i++) {
      h += _EQ_height[((flipped) ? _EQ_height.length-i-1 : i)]
      EQP_EQ_height[i] = h
    }
  }
// END


  var _gallery_TEMP = []
  for (var i = 0; i < EQP_gallery.length; i++) {
    var g = EQP_gallery[i]

    var name = g.replace(/\.EQP-\w+\.\w+$/i, "")

    var obj = { src:g }
    if (!EQP_FilePara(obj)) {
      _gallery_TEMP[name] = { bg:obj }
      continue
    }

    var obj_parent = _gallery_TEMP[name]
    if (!obj_parent)
      obj_parent = {}

    if (obj.type == "bg")
      obj_parent.bg = obj
    else {
      if (!obj_parent.imgs)
        obj_parent.imgs = []

      obj_parent.imgs.push(obj)
    }

    _gallery_TEMP[name] = obj_parent
  }

  for (var name in _gallery_TEMP) {
    var obj = _gallery_TEMP[name]
    if (!obj.bg)
      continue

    EQP_gallery_obj.push(obj)
  }


// Main
  var obj
  obj = EQP_gallery_obj_active = EQP_gallery_obj[random(EQP_gallery_obj.length)]

  var bg = obj.bg

  if (obj.imgs)
    obj.imgs.sort(function (a,b) {return a.z - b.z})
  else {
    obj.imgs = [{src:bg.src, z:0}]

    if (bg.is_video) {
      bg.is_filter = true
      bg.is_video = false

      var img = obj.imgs[0]
      img.use_Silverlight = true
      img.is_video = true
      img.play_sound = bg.play_sound
      img.use_media_control = true
      img.w = bg.w = (bg.w > 0) ? bg.w : 320
      img.h = bg.h = (bg.h > 0) ? bg.h : 240
      img.w_video = (bg.w_video > 0) ? bg.w_video : -1
      img.h_video = (bg.h_video > 0) ? bg.h_video : -1

//bg.use_SEQ = true
//bg.SEQ = { speed_min:0.2, speed_max:1 }

      EV_SL_MediaOpened = function (sender, args) {
var w = sender.NaturalVideoWidth
var h = sender.NaturalVideoHeight

var bg  = EQP_gallery_obj_active.bg
var img = EQP_gallery_obj_active.imgs[0]
var w = (img.w_video > 0) ? img.w_video : sender.NaturalVideoWidth
var h = (img.h_video > 0) ? img.h_video : sender.NaturalVideoHeight
if (img.w_video && img.h_video)
  sender.Stretch = "Fill"

DEBUG_show('Video:'+w+'x'+h,2)

EQP_gallery_obj_active.w_org = bg.w_org = img.w_org = w
EQP_gallery_obj_active.h_org = bg.h_org = img.h_org = h

resize()
      }
    }
    else {
      obj.use_filter = true

      if (use_Silverlight) {
        SL_ST_enabled = false
        SL_PP_enabled = false
      }
    }

    if (EQP_bg_color == null)
      EQP_bg_color = "black"
  }

  for (var i = 0; i < obj.imgs.length; i++)
    obj.imgs[i].load = EQP_MM_Load


  EQP_ps = bg.EQP_ps = []
  for (var i = 0; i < EQP_EQ_divider; i++) {
    var ps
    ps = EQP_ps[i] = {}

// Defaults START
    ps.o_last = -1
    ps.decay = {}
    ps.decay2 = {}

    ps.decay_factor = EQP_decay_factor
    ps.decay_factor2 = EQP_decay_factor2

    ps.g_EQ = [EQP_FB_EQ[i]]

    ps.u_min = 0
    ps.u_max = 100

    ps.o_min = (EQP_u_reversed) ? 100 : 0
    ps.o_max = (EQP_u_reversed) ? 0 : 100

    ps.SL_clip = []
// END

// Find the min and max EQ bar used - START
if (ps.g_EQ || ps.g_num) {
  var g = (ps.g_EQ) ? ps.g_EQ : ps.g_num

  for (var k = 0; k < g.length; k++) {
    var v = g[k]
    var EQ_min, EQ_max

    if (ps.g_EQ) {
      EQ_min = v[0]
      EQ_max = v[v.length-1]
    }
    else {
      if (v == 0) {
        EQ_min = 0
        EQ_max = 3
      }
      else if (v == 1) {
        EQ_min = 4
        EQ_max = 11
      }
      else {
        EQ_min = 12
        EQ_max = 15
      }
    }

    if (EQP_EQ_min > EQ_min)
      EQP_EQ_min = EQ_min
    if (EQP_EQ_max < EQ_max)
      EQP_EQ_max = EQ_max
  }
}
// END
  }


// object dimension
  var w_ani = 320
  var h_ani = 240
  var ratio = 1

if (!bg.w || !bg.h) {
  var dim = loadImageDim(bg.src)
  var w = dim.w
  var h = dim.h
  if (obj.use_filter) {
    var pixels = w * h
    if (pixels > 600000) {
      obj.use_gimage = true
      var ratio = Math.sqrt(480000 / pixels)

      w = parseInt(w * ratio)
      h = parseInt(h * ratio)
      if (w % 2)
        w--
      if (h % 2)
        h--
    }
  }

  bg.w = w
  bg.h = h
}

  w_ani = bg.w_org = bg.w_default = bg.w
  h_ani = bg.h_org = bg.h_default = bg.h


  var imgs = obj.imgs
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i]

var w, h
if (!img.w || !img.h) {
  var dim = loadImageDim(img.src)
  w = dim.w
  h = dim.h
  if (ratio != 1) {
    w = parseInt(w * ratio)
    h = parseInt(h * ratio)
    if (w % 2)
      w--
    if (h % 2)
      h--
  }

  img.w = w
  img.h = h
}

    w = img.w_org = img.w_default = img.w
    h = img.h_org = img.h_default = img.h

    if (w_ani < w)
      w_ani = w
    if (h_ani < h)
      h_ani = h
  }

  obj.x_offset = obj.y_offset = 0
  if (EV_width) {
    obj.x_offset = (EV_width - w_ani) / 2
    w_ani = EV_width
  }
  if (EV_height) {
    obj.y_offset = (EV_height - h_ani) / 2
    h_ani = EV_height
  }

  obj.w = obj.w_org = w_ani
  obj.h = obj.h_org = h_ani

  EQP_border_width = (EQP_bg_color && EQP_bg_border && /^(\d+)/.test(EQP_bg_border)) ? parseInt(RegExp.$1) : 0

// position
  if (bg.x == null)
    bg.x = parseInt((w_ani - bg.w) / 2)
  if (bg.y == null)
    bg.y = parseInt((h_ani - bg.h) / 2)
  bg.x_org = bg.x_default = bg.x
  bg.y_org = bg.y_default = bg.y

  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i]

    if (img.x == null)
      img.x = parseInt((w_ani - img.w) / 2)
    if (img.y == null)
      img.y = parseInt((h_ani - img.h) / 2)
    img.x_org = img.x_default = img.x
    img.y_org = img.y_default = img.y
  }
// END

if (EQP_dragdrop_obj) {
  var obj_dragdrop = eval(EQP_dragdrop_obj.obj_str)
  obj_dragdrop.dragdrop = EQP_dragdrop_obj.dragdrop

  EQP_DragDrop_Init(obj_dragdrop)
}


  if (EQP_bg_color) {
    var html_bg
    html_bg = obj.html_bg = document.createElement("div")
    html_bg.style.position = "absolute"
    html_bg.style.posLeft = 0
    html_bg.style.posTop = 0
    html_bg.style.backgroundColor = EQP_bg_color
    if (EQP_bg_border)
      html_bg.style.border = EQP_bg_border

    L_EV_content.appendChild(html_bg)
  }

  if (EQP_allow_resize && !document.body.ondblclick) {
    if (!use_Silverlight)
      document.body.title += ', double-click to change size'
    document.body.ondblclick = EQP_onresize
  }

  if (!EV_usage_sub)
    EV_usage_sub = EV_usage_sub_CREATE(null, "sound", 3)

  EQP_resize(((EQP_allow_resize) ? null : 1))

  if (EQP_init_extra)
    EQP_init_extra()


// Silverlight
  if (use_Silverlight)
    SL_Init()
}

if (!EV_init)
  EV_init = EQP_EV_init


var EQP_EV_animate_full = function () {
//DEBUG_show(PC_count_absolute)
  if (use_Silverlight && !SL_loaded)
    return

/*
var bg = EQP_gallery_obj_active.bg
if (bg.use_SEQ)
  SL_Media_SEQ(bg, EQP_gallery_obj_active.imgs[0].img_obj)
else {
}
*/

  for (var i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]

    var u = -1
    if (EV_usage_sub) {
      if (EQP_EQ_mode && ps.g_EQ) {
        var EQ = ps.g_EQ[EQP_EQ_index]

        u = 0
        for (var k = 0; k < EQ.length; k++)
          u += EV_usage_sub.sound_raw[EQ[k]].usage_raw * Sound_EQBand_mod
        u /= EQ.length

        u = EV_usage_PROCESS(null, u)
      }
      else if (ps.g_num)
        u = EV_usage_sub.sound[ps.g_num[EQP_EQ_index]].EV_usage_float
    }

    if (u == -1)
      u = EV_usage_float

    u = EQP_EV_usage_PROCESS(ps.decay2, u, ps.decay_factor2)

    var u_min = ps.u_min
    var u_max = ps.u_max
    if (u < u_min)
      u = (u <= ps.u_min_hidden) ? -1 : 0
    else if (u >= u_max)
      u = (u >= ps.u_max_hidden) ? -1 : 100
    else
      u = (u_max == u_min) ? 100 : (u - u_min) / (u_max - u_min) * 100

    var opacity
    if (u == -1)
      opacity = 0
    else {
      u = EQP_EV_usage_PROCESS(ps.decay, u, ps.decay_factor)
      opacity = parseInt(ps.o_min + (ps.o_max - ps.o_min) * u/100)
    }

    if (ps.o_last == opacity)
      continue
    ps.o_last = opacity


opacity /= 100

var bg = EQP_gallery_obj_active.bg
var w = bg.w
var h = bg.h
if (!w || !h)
  continue

var T, R, B, L
var Ti,Ri,Bi,Li
var ii
T = B = h
R = L = w
Ti = Ri = Bi = Li = -1

var dim_ref
if (EQP_FB_rotation == 0) {
  dim_ref = h

  ii = (EQP_FB_flipH) ? EQP_EQ_divider-i : i+1
  Ri = ii
  Li = ii - 1
  if (EQP_FB_align_center) {
    var hh = h * EQP_FB_align_center_shift
    T = hh * (1-opacity)
    B = hh + (h-hh) * opacity
  }
  else if (EQP_FB_flipV) {
    T = 0
    B = h * opacity
  }
  else {
    T = h * (1-opacity)
    B = h
  }
}
else {
  dim_ref = w

  ii = (EQP_FB_flipV) ? EQP_EQ_divider-i : i+1
  Ti = ii - 1
  Bi = ii
  if (EQP_FB_align_center) {
    var ww = w * (1-EQP_FB_align_center_shift)
    R = ww + (w-ww) * opacity
    L = ww * (1-opacity)
  }
  else if (EQP_FB_flipH) {
    R = w
    L = w * (1-opacity)
  }
  else {
    R = w * opacity
    L = 0
  }
}

var Z  = [T, R, B, L]
var Zi = [Ti,Ri,Bi,Li]

var scale = (use_Silverlight && SL_ST_enabled) ? 1 : EQP_size_scale

for (var k = 0; k < 4; k++) {
  var zi = Zi[k]
  if (zi == -1) {
    if (EQP_EQ_height) {
      var zz = dim_ref - Z[k]
      var h_max = EQP_EQ_height.length
      var index = parseInt(zz / (dim_ref / h_max))
      if (index > h_max)
        index = h_max

      Z[k] = dim_ref - ((index == 0) ? 0 : EQP_EQ_height[index-1])
    }
    continue
  }

  if (EQP_EQ_width) {
    if (zi == 0) {
      Z[k] = 0
      continue
    }
    if (zi >= EQP_EQ_width.length)
      continue

    Z[k] = EQP_EQ_width[zi-1] * scale
  }
  else
    Z[k] *= zi / EQP_EQ_divider
}

for (var k = 0; k < 4; k++)
  Z[k] = Math.round(Z[k])


if (use_Silverlight) {
  var TL = [Z[3],Z[0]]
  var TR = [Z[1],Z[0]]
  var BR = [Z[1],Z[2]]
  var BL = [Z[3],Z[2]]

  if (EQP_FB_rotation == 0) {
    if (EQP_FB_flipH)
      ps.SL_clip = [TR,TL, BL,BR]
    else
      ps.SL_clip = [TL,TR, BR,BL]
  }
  else {
    if (EQP_FB_flipV)
      ps.SL_clip = [BL,TL, TR,BR]
    else
      ps.SL_clip = [TL,BL, BR,TR]
  }
}
else
  ps.img_obj.style.clip = "rect(" + Z[0] + "px, " + Z[1] + "px, " + Z[2] + "px, " + Z[3] + "px)"

  }

  if (use_Silverlight) {
    var points = []
    for (var i = 0; i < EQP_ps.length; i++) {
      var clip = EQP_ps[i].SL_clip
      points.push(clip[0],clip[1])
    }
    for (var i = EQP_ps.length-1; i >= 0; i--) {
      var clip = EQP_ps[i].SL_clip
      points.push(clip[2],clip[3])
    }

    var points_str = points.toString()
    if (EQP_gallery_obj_active.SL_points_str != points_str) {
      EQP_gallery_obj_active.SL_points_str = points_str
      SL_root.FindName("bg_StartPoint").StartPoint = points[0].toString()
      SL_root.FindName("bg_Points").Points = points_str
    }
  }

  if (EQP_animate_extra)
    EQP_animate_extra()
}

if (!EV_animate_full)
  EV_animate_full = EQP_EV_animate_full


// CORE
document.write('<script language="JavaScript" src="js/EQP_core.js"></scr'+'ipt>');


// Pixastic
var use_Pixastic
if (ie9_mode) {
  use_Pixastic = true
  document.write('<script language="JavaScript" src="js/pixastic.js"></scr'+'ipt>');
//  document.write('<script language="JavaScript" src="js/pixastic_noise.js"></scr'+'ipt>');
  document.write('<script language="JavaScript" src="js/pixastic_pointillize.js"></scr'+'ipt>');
  document.write('<script language="JavaScript" src="js/pixastic_hsl.js"></scr'+'ipt>');
}


// Silverlight
var EV_SL_init = function () {
  EQP_resize(((EQP_allow_resize) ? null : 1))
}

if (use_Silverlight) {
  document.write('<script language="JavaScript" src="js/Silverlight.js"></scr'+'ipt>');
  document.write('<script language="JavaScript" src="js/SA_silverlight.js"></scr'+'ipt>');
}
