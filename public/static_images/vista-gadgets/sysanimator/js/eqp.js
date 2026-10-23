// EQP (v2.1.7)

//  SA defaults
var EV_init
var EV_width, EV_height
var EV_BG_src, EV_BG_allow_dummy
var EV_animate_full

var use_full_spectrum = true
// END


var use_EQP_normal = true

var EQP_use_HTML_IMG, EQP_use_HTML_IMG_FULL
// No 'EQP_HTML_bg_color' by default since v3.7.6
var EQP_HTML_bg_color = "";

var EQP_EV_width, EQP_EV_height
var EQP_ref_width, EQP_ref_height
var EQP_BG_width, EQP_BG_height
var EQP_BG_x, EQP_BG_y
var EQP_init_extra, EQP_animate_extra
var EQP_EQ_mode, EQP_EQ_index
var EQP_EQ_min = 99
var EQP_EQ_max = 0
var EQP_o_min, EQP_o_max
var EQP_allow_resize
var EQP_size_scale = 1
var EQP_size_scale_auto = true

var EQP_ps

var EQP_SL_xaml = []

/*
"EQP_decay_factor" is applied to the opacity. It's 0.2 by default (i.e. value can drop no more than 20% of the maximum value in a single update at 10fps).
"EQP_decay_factor2" is applied to the system activity value. It's 1.0 by default (i.e. value can drop fully).
Changing these values may produce some interesting results.
*/
var EQP_decay_factor
var EQP_decay_factor2

var use_EQP_FB


function EQP_resize(scale, no_msg) {
  EQP_resize_CORE(scale, no_msg)


  var scale_org = EQP_size_scale
  if (use_Silverlight && SL_ST_enabled)
    EQP_size_scale = 1


  if (EQP_use_HTML_IMG_FULL)
    EV_BG_allow_dummy = (EQP_size_scale == 1)

  for (var i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]

if (ps.use_Silverlight) {
  if (!SL_loaded)
    continue

  var img = ps.img
  if (!img)
    continue

  if (ps.fixed_size) {
    img.Visibility = (((EQP_size_scale == 0.5) && ps.half_size) || ((EQP_size_scale == 1) && ps.full_size)) ? "Visible" : "Collapsed";
    continue
  }

  if (ps.w_org > 0)
    img.Width  = ps.w_org * EQP_size_scale
  if (ps.h_org > 0)
    img.Height = ps.h_org * EQP_size_scale
  img["Canvas.Left"] = (ps.x_org - EQP_SL_x) * EQP_size_scale
  img["Canvas.Top"] = (ps.y_org - EQP_SL_y) * EQP_size_scale

  if (ps.is_video) {
    var obj_v = SL_root.FindName(img.Name + "_obj")
    if (ps.w_video > 0)
      obj_v.Width  = ps.w_video
    if (ps.h_video > 0)
      obj_v.Height = ps.h_video
  }

  continue
}

    if (ps.use_HTML_IMG) {
      if (EQP_size_scale == 0.5) {
        if (ps.img_GADGET) {
          ps.img = ps.img_GADGET
          ps.img.opacity = (ps.img_HTML) ? ((ie9_mode) ? ps.img_HTML.opacity*100 : ps.img_HTML.opacity) : ps.o_min
          ps.img_obj.style.display = "none"
        }
        else {
          ps.img_obj.style.display = (ps.half_size) ? "block" : "none"
          continue
        }
      }
      else {
        if (ps.img_GADGET) {
          if (ps.img_HTML) {
            ps.img = ps.img_HTML
            ps.img.opacity = (ie9_mode) ? ps.img_GADGET.opacity/100 : ps.img_GADGET.opacity
          }
          else
            ps.img = null
          ps.img_GADGET.opacity = 0
          ps.img_obj.style.display = "block"
          continue
        }
        else {
          ps.img_obj.style.display = (ps.full_size) ? "block" : "none"
          continue
        }
      }
    }
    if (!ps.img)
      continue

    var w = ps.w_org * scale_org
    var h = ps.h_org * scale_org

    var img = ps.img
    img.left = (w - ps.w_org)/2 + ps.x_org * scale_org
    img.top  = (h - ps.h_org)/2 + ps.y_org * scale_org
    img.width  = w
    img.height = h
  }


  EQP_size_scale = scale_org

  var s = BG.style
  s.posLeft = Math.round(EQP_BG_x * EQP_size_scale)
  s.posTop  = Math.round(EQP_BG_y * EQP_size_scale)
  s.pixelWidth  = Math.round(EQP_BG_width  * EQP_size_scale)
  s.pixelHeight = Math.round(EQP_BG_height * EQP_size_scale)

  EV_width  = Math.round(EQP_EV_width  * EQP_size_scale)
  EV_height = Math.round(EQP_EV_height * EQP_size_scale)

  if (use_Silverlight && SL_loaded) {
    var ss = SL_Host_Parent.style
    ss.pixelWidth  = Math.round(EQP_SL_w * EQP_size_scale)
    ss.pixelHeight = Math.round(EQP_SL_h * EQP_size_scale)
    ss.posLeft = Math.round(EQP_SL_x * EQP_size_scale)
    ss.posTop  = Math.round(EQP_SL_y * EQP_size_scale)

    if (use_HTML5) {
SL.width  = ss.pixelWidth
SL.height = ss.pixelHeight
    }
    else if (use_SVG) {
    }
    else {
      SL_ArrangeButtons()

      if (SL_ST_enabled) {
        var st = SL_root.FindName("content_ST")
        st.ScaleX = st.ScaleY = EQP_size_scale * SL_fullscreen_scale
      }
    }
  }
}


var EQP_meter_count = 1

var EQP_SL_w, EQP_SL_h
var EQP_SL_x = 0
var EQP_SL_y = 0

var EQP_EV_initialized

var EQP_EV_init = function () {
  if (EQP_EV_initialized) {
    if (EQP_allow_resize)
      EQP_resize()

    return
  }
  EQP_EV_initialized = true

  EQP_EV_width = EV_width
  EQP_EV_height = EV_height


// Defaults START
  var size_default = (System.Gadget.docked) ? 0.5 : 1
  EQP_size_scale = parseFloat(LABEL_LoadSettings("LABEL_EQP_size_scale", size_default))
  if (EQP_size_scale != size_default)
    EQP_size_scale_default = EQP_size_scale

  if (!EQP_ref_width)
    EQP_ref_width = EV_width
  if (!EQP_ref_height)
    EQP_ref_height = EV_height

  if (!EQP_BG_width)
    EQP_BG_width = EV_width
  if (!EQP_BG_height)
    EQP_BG_height = EV_height
  if (!EQP_BG_x)
    EQP_BG_x = 0
  if (!EQP_BG_y)
    EQP_BG_y = 0

  if (!EQP_parts_path)
    EQP_parts_path = "parts_" + EV_width + "x" + EV_height

  if (!EQP_use_HTML_IMG)
    EQP_use_HTML_IMG = false

  if (EQP_EQ_mode == null)
    EQP_EQ_mode = true

  if (EQP_decay_factor == null)
    EQP_decay_factor = 0.2
  if (EQP_decay_factor2 == null)
    EQP_decay_factor2 = 1

  if (EQP_o_min == null)
    EQP_o_min = 0
  if (EQP_o_max == null)
    EQP_o_max = 100

  if (EQP_EQ_index == null)
    EQP_EQ_index = 0
// END


//  BG.removeObjects()
  var _SL_TL = []
  var _SL_LR = []

  var svg_objs = []

  var ani_path = Settings.f_path + '\\' + EQP_parts_path + '\\'
  for (var i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]

// Defaults START
    ps.z = i
    ps.src = ps.src.replace(/\//g, "\\")

    var RE = /\.(bmp|gif|jpg|jpeg|png|wmv|mp4)$/i;
    ps.file_ext = (RE.test(ps.src)) ? RegExp.$1 : 'png'
    ps.is_video = /wmv|mp4/i.test(ps.file_ext)

    if (ps.is_video && !use_Silverlight)
      continue

    ps.src = ps.src.replace(RE, "")
    var img_path = ani_path + ps.src + '.' + ps.file_ext

    ps.o_last = -1
    ps.decay = {}
    ps.decay2 = {}

    if (ps.decay_factor == null)
      ps.decay_factor = EQP_decay_factor
    if (ps.decay_factor2 == null)
      ps.decay_factor2 = EQP_decay_factor2

    if (ps.o_min == null)
      ps.o_min = EQP_o_min
    else if (ps.o_min == -1) {
      ps.o_min = 100
      ps.static_part = true
    }
    if (ps.o_max == null)
      ps.o_max = EQP_o_max
    if (ps.o_min == ps.o_max)
      ps.static_part = true

    if (ps.u_min == null)
      ps.u_min = 0
    if (ps.u_max == null)
      ps.u_max = 100
    if (ps.u_min_hidden == null)
      ps.u_min_hidden = -1
    if (ps.u_max_hidden == null)
      ps.u_max_hidden = 999

    ps.load = EQP_MM_Load
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


    var w = -1
    var h = -1

    var x = null
    var y = null
    if (ps.x != null)
      x = ps.x
    if (ps.y != null)
      y = ps.y
    if (/_(\d+)x(\d+)$/.test(ps.src) || (ps.xy && /^(\d+)x(\d+)$/.test(ps.xy))) {
      x = EQP_ref_width - parseInt(RegExp.$1) + ((ps.x_offset) ? ps.x_offset : 0)
      y = EQP_ref_height - parseInt(RegExp.$2) + ((ps.y_offset) ? ps.y_offset : 0)
    }

    if (ps.use_HTML_IMG)
      EQP_use_HTML_IMG = true
    ps.use_HTML_IMG = EQP_use_HTML_IMG
    var use_GADGET_IMG = !EQP_use_HTML_IMG

    if (EQP_use_HTML_IMG) {
      if (i == 0) {
        EQP_use_HTML_IMG_FULL = true

        if (EQP_HTML_bg_color == null)
          EQP_HTML_bg_color = "black"
      }
      if (EQP_HTML_bg_color) {
        var bg = document.createElement("div")
        bg.style.position = "absolute"
        bg.style.posLeft = 0
        bg.style.posTop = 0
        bg.style.pixelWidth = EV_width
        bg.style.pixelHeight = EV_height
        bg.style.backgroundColor = EQP_HTML_bg_color

        L_EV_content.appendChild(bg)

        // Make sure it is used only ONCE.
        EQP_HTML_bg_color = ""
      }

      if (x == null)
        x = y = 0
      ps.x_org = x
      ps.y_org = y

      var use_alpha = (!ps.static_part || (ps.o_min < 100))
      ps.use_alpha = use_alpha

if (use_SVG) {
  ps.use_SVG = ps.use_Silverlight = true

  var img_id = "main" + i + ((ps.is_video) ? "v" : "i")

  if (ps.w != null)
    w = ps.w
  if (ps.h != null)
    h = ps.h

  var svg = SVG_Object(img_id, ps)
  svg['Canvas.ZIndex'] = i
  svg['Canvas.Left'] = x
  svg['Canvas.Top'] = y
  if (use_alpha)
    svg.Opacity = ps.o_min/100

  if (ps.is_video) {}
  else {
    if (w == -1) {
      var dim = loadImageDim(img_path)
      w = dim.w
      h = dim.h
    }

    ps.img_obj_i = svg
  }

  ps.img = svg_objs[svg_objs.length] = svg

  ps.w_org = w
  ps.h_org = h

  svg.Source = toFileProtocol(img_path)

  if (ps.dragdrop)
    EQP_DragDrop_Init(ps)
}
else if (use_HTML5) {
  ps.use_HTML5 = ps.use_Silverlight = true

  var img_id = "main" + i + ((ps.is_video) ? "v" : "i")

  if (ps.w != null)
    w = ps.w
  if (ps.h != null)
    h = ps.h

  var c_obj = new CANVAS_Object(img_id, ps)
  var canvas = c_obj.canvas
  canvas['Canvas.ZIndex'] = i
  canvas['Canvas.Left'] = x
  canvas['Canvas.Top'] = y
  if (use_alpha)
    canvas.Opacity = ps.o_min/100

  if (ps.is_video) {}
  else {
    if (w == -1) {
      var dim = loadImageDim(img_path)
      w = dim.w
      h = dim.h
    }

    ps.img_obj_i = canvas
  }

  ps.img = canvas

  ps.w_org = w
  ps.h_org = h

  canvas.Source = toFileProtocol(img_path)

  if (ps.dragdrop)
    EQP_DragDrop_Init(ps)
}
else if (use_Silverlight) {
  ps.use_Silverlight = true

  var img_id = "main" + i

  if (ps.w != null)
    w = ps.w
  if (ps.h != null)
    h = ps.h

  var xaml_para = 'Canvas.ZIndex="' + i + '" Canvas.Left="' + x + '" Canvas.Top="' + y + '"' + ((use_alpha) ? ' Opacity="' + (ps.o_min/100) + '"' : '') + ' ';
  var xaml_src  = 'Source="' + toFileProtocol(img_path) + '" ';

  var xaml
  if (ps.is_video) {
    img_id += "v"

    var mask = ''
    if (para.mask) {
      mask =
  '<Canvas.OpacityMask>\n'
+ '<ImageBrush x:Name="' + img_id + '_mask" ImageSource="' + toFileProtocol(para.mask) + '"/>\n'
+ '</Canvas.OpacityMask>\n'
    }

    var mask_v = ''
    if (para.mask_v) {
      mask_v =
  '<MediaElement.OpacityMask>\n'
+ '<ImageBrush x:Name="' + img_id + '_obj_mask" ImageSource="' + toFileProtocol(para.mask_v) + '"/>\n'
+ '</MediaElement.OpacityMask>\n'
    }

    xaml =
  '<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + '" '
+ xaml_para
+ '>\n'
+ mask
+ '<MediaElement x:Name="' + img_id + '_obj" '
+ xaml_src
+ ((w > 0) ? 'Width="' + w + '" Height="' + h + '" ' : '')
+ 'MediaOpened="SL_MediaOpened" MediaEnded="SL_MediaEnded" '
+ ((ps.use_media_control) ? 'MouseEnter="SL_Media_MouseEnter" ' : '')
+ ((ps.play_sound) ? 'Volume="1"' : 'IsMuted="true"')
+ '>\n'
+ mask_v
+ '</MediaElement>\n'
+ '</Canvas>'

    ps.w_video = w
    ps.h_video = h
  }
  else {
    img_id += "i"

    xaml =
  '<Image xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + '" '
+ xaml_para + xaml_src
+ '>\n'
+ '</Image>'

    if (w == -1) {
      var dim = loadImageDim(img_path)
      w = dim.w
      h = dim.h
    }
  }

  if ((i > 0) && ps.group_id) {
    var i_last = i - 1
    var ps_last = EQP_ps[i_last]
    if (ps_last.group_id == ps.group_id) {
      xaml = EQP_SL_xaml[i_last] + '\n' + xaml
      EQP_SL_xaml[i_last] = null
    }
  }

  EQP_SL_xaml[i] = xaml

  ps.img = img_id

  ps.w_org = w
  ps.h_org = h

  if (ps.dragdrop)
    EQP_DragDrop_Init(ps)
}
else {
  var img = document.createElement("img")
  img.style.position = "absolute"
  img.style.posLeft = x
  img.style.posTop = y
  img.src = toFileProtocol(img_path)
  if (use_alpha) {
    if (ie9_mode)
      img.style.opacity = ps.o_min/100
    else
      img.style.filter = "progid:DXImageTransform.Microsoft.Alpha(opacity=" + ps.o_min + ")"
  }

  L_EV_content.appendChild(img)
  ps.img_obj = img

  if (use_alpha)
    ps.img = ps.img_HTML = (ie9_mode) ? img.style : img.filters.item("DXImageTransform.Microsoft.Alpha")
}

      if (EQP_allow_resize) {
        ps.full_size = (ps.full_size == null) ? true : ps.full_size
        ps.half_size = (ps.half_size == null) ? true : ps.half_size

        if (ps.full_size && ps.half_size) {
          use_GADGET_IMG = !use_Silverlight
        }
        else
          ps.fixed_size = true
      }
    }
    else {
      if (use_Silverlight)
        SL_ST_enabled = false
    }

    if (use_GADGET_IMG) {
      if (!ps.static_part) {
        if (ps.o_min > 99)
          ps.o_min = 99
        if (ps.o_max > 99)
          ps.o_max = 99
      }

      var img = BG.addImageObject(img_path, 0,0)
      w = ps.w_org = img.width
      h = ps.h_org = img.height

      if (x == null) {
        x = parseInt((EQP_ref_width - img.width) / 2)
        y = parseInt((EQP_ref_height - img.height) / 2)
        if (x % 2)
          x++
        if (y % 2)
          y++
      }

      x = ps.x_org = x - EQP_BG_x
      y = ps.y_org = y - EQP_BG_y

      img.left = x
      img.top = y
      img.opacity = ps.o_min
      ps.img = ps.img_GADGET = img

      if (use_Silverlight)
        SL_PP_enabled = false
    }

var _SL_TL_x = _SL_TL[0]
if ((_SL_TL_x == null) || (_SL_TL_x > x))
  _SL_TL[0] = x
var _SL_TL_y = _SL_TL[1]
if ((_SL_TL_y == null) || (_SL_TL_y > y))
  _SL_TL[1] = y

var _SL_LR_x = _SL_LR[0]
if ((_SL_LR_x == null) || (_SL_LR_x < x+w))
  _SL_LR[0] = x+w
var _SL_LR_y = _SL_LR[1]
if ((_SL_LR_y == null) || (_SL_LR_y < y+h))
  _SL_LR[1] = y+h

    // cross-script compatibility
    ps.x_default = x
    ps.y_default = y
    ps.w_default = w
    ps.h_default = h
  }

  if (EQP_allow_resize && !document.body.ondblclick) {
    if (!use_Silverlight_only)
      document.body.title += ', double-click to change size'
    document.body.ondblclick = EQP_onresize
  }

  EV_BG_src = ""

  var s = BG.style
  s.posLeft = EQP_BG_x
  s.posTop = EQP_BG_y
  s.pixelWidth = EQP_BG_width
  s.pixelHeight = EQP_BG_height

//DEBUG_show(EQP_EQ_min+'-'+EQP_EQ_max)
  if (!EV_usage_sub)
    EV_usage_sub = EV_usage_sub_CREATE(null, "sound", 3)

  if (use_Silverlight_only && !EQP_SL_xaml.length)
    use_Silverlight = false

  if (EQP_allow_resize || use_Silverlight)
    EQP_resize()
  else {
    if (EQP_use_HTML_IMG_FULL)
      EV_BG_allow_dummy = (EQP_size_scale == 1)
  }

  if (EQP_init_extra)
    EQP_init_extra()


// Silverlight
  if (use_Silverlight) {
//DEBUG_show(_SL_TL+'x'+_SL_LR,0,true)
    var x = _SL_TL[0]
    var y = _SL_TL[1]
    EQP_SL_x = x
    EQP_SL_y = y
    EQP_SL_w = _SL_LR[0] - x
    EQP_SL_h = _SL_LR[1] - y
//DEBUG_show(EQP_SL_x+','+EQP_SL_y+'/'+EQP_SL_w+'x'+EQP_SL_h,0,true)

    if (use_HTML5)
      HTML5_Init()
    else if (use_SVG)
      SVG_Init(svg_objs)
    else
      SL_Init()
  }
}

if (!EV_init)
  EV_init = EQP_EV_init


var CANVAS_must_redraw

var EQP_EV_animate_full = function () {
//DEBUG_show(PC_count_absolute)
//context = SL.getContext("2d")
  if (use_Silverlight && !SL_loaded)
    return

  for (var i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]
    if (ps.static_part)
      continue

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

//if (opacity == 100) DEBUG_show(opacity+','+i)

    if (ps.o_last != opacity) {
      ps.o_last = opacity

      if (ps.use_Silverlight) {
        ps.img.Opacity = opacity / 100

        if (ps.use_HTML5)
          CANVAS_must_redraw = true
      }
      else
        ps.img.opacity = (ie9_mode) ? opacity/100 : opacity
    }
  }

  if (CANVAS_must_redraw) {
    var context = SL.getContext("2d")

    for (var i = 0; i < EQP_ps.length; i++) {
      var ps = EQP_ps[i]
      if (!ps.use_HTML5)
        continue

var canvas = ps.img
// make sure it is already drawn once
canvas.canvas_parent.draw(true)

if (canvas.image_data) {
//DEBUG_show(canvas.image_data.width+'x'+canvas.image_data.height)
  context.putImageData(canvas.image_data, canvas.x_resized,canvas.y_resized)
}
else {
  context.globalAlpha = canvas.Opacity
  context.drawImage(canvas, canvas.x_resized,canvas.y_resized)
}
    }

    if (SL_mask['content_mask'] && SL_mask['content_mask'].Mask_src) {
var mask_obj = SL_mask['content_mask']
mask_obj.draw(true)

var canvas = mask_obj.canvas
if (canvas.image_data) {
  var mask_image_data_array = canvas.image_data.data
  var image_data = context.getImageData(canvas.x_resized,canvas.y_resized, canvas.width,canvas.height)
  var image_data_array = image_data.data

  var max = image_data_array.length
  for (var ac = 3; ac < max/4; ac += 4) {
image_data_array[ac]=128//parseInt(image_data_array[ac] * mask_image_data_array[ac]/255)
  }

DEBUG_show(image_data_array[3])

  context.putImageData(image_data, canvas.x_resized,canvas.y_resized)
}
    }

    CANVAS_must_redraw = false
  }

  if (EQP_animate_extra)
    EQP_animate_extra()
}

if (!EV_animate_full)
  EV_animate_full = EQP_EV_animate_full


// CORE
document.write('<script language="JavaScript" src="js/EQP_core.js"></scr'+'ipt>');


// EQP - Free BG version
if (use_EQP_FB)
  document.write('<script language="JavaScript" src="js/EQP_FB.js"></scr'+'ipt>');


// Silverlight
var EV_SL_init = function () {

try {
  var group_id
  for (var i = 0; i < EQP_SL_xaml.length; i++) {
    var xaml = EQP_SL_xaml[i]
    if (!xaml) {
      group_id = EQP_ps[i].group_id
      continue
    }

    if (group_id) {
      xaml =
  '<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + group_id + '" '
+ 'Canvas.ZIndex="' + i + '"'
+ '>\n'
+ xaml + '\n'
+ '</Canvas>'
      group_id = null
    }

    SL_content.children.add(SL.content.createFromXaml(xaml, false));
  }
}
catch (err) { DEBUG_show(err.description, 0,true) }

try {
  var i
  for (i = 0; i < EQP_ps.length; i++) {
    var ps = EQP_ps[i]

    if (!ps.use_Silverlight)
      continue

    var img = ps.img
    if (!img)
      continue

    var name = ps.img
    img = ps.img = SL_root.FindName(name)

    if (ps.is_video)
      ps.img_obj_v = img
    else
      ps.img_obj_i = img
  }
}
catch (err) { DEBUG_show(err.description + '(' + i + ')', 0,true) }

// Enforce proper resizing
resize()

}


// Silverlight scripts
if (use_Silverlight) {
  if (use_HTML5) {
    document.write('<script language="JavaScript" src="js/html5.js"></scr'+'ipt>');
  }
  else if (use_SVG) {
    document.write('<script language="JavaScript" src="js/svg.js"></scr'+'ipt>');
  }
  else {
    document.write('<script language="JavaScript" src="js/Silverlight.js"></scr'+'ipt>');
    document.write('<script language="JavaScript" src="js/SA_silverlight.js"></scr'+'ipt>');
  }
}
