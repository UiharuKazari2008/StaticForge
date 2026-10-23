// EQP core (v1.1.4)

var use_EQP_core = true

var use_EQP_normal
var EQP_size_scale_default

var use_WMP

function EQP_EV_usage_PROCESS(obj, u, decay_factor) {
  u /= 100

// decay control
  if (Settings.ReverseAnimation) {
    if (u - decay_factor > obj.EQP_u_last)
      u = obj.EQP_u_last + decay_factor
  }
  else {
    if (u + decay_factor < obj.EQP_u_last)
      u = obj.EQP_u_last - decay_factor
  }
  obj.EQP_u_last = u

  return u * 100
}


function EQP_onresize() {
  if (EQP_size_scale_auto)
    EQP_size_scale = (EQP_size_scale == 1) ? 0.5 : 1
  EQP_size_scale_auto = false

  resize()
}

function EQP_resize_CORE(scale, no_msg) {
  var size_default = (System.Gadget.docked) ? 0.5 : 1

  if (scale)
    EQP_size_scale = scale
  else {
    if (EQP_size_scale_auto) {
      if (EQP_size_scale == size_default)
        EQP_size_scale_default = null

      if (EQP_size_scale_default)
        EQP_size_scale = EQP_size_scale_default
      else
        EQP_size_scale = (System.Gadget.docked) ? 0.5 : 1
    }
    EQP_size_scale_auto = true
  }

  if (!use_Silverlight && (EQP_size_scale % ((EQP_allow_resize) ? 0.5 : 1)))
    EQP_size_scale = 1

  if (!no_msg) {
    if (use_Silverlight) {
      if (SL_loaded) {
        if (EQP_size_scale == 1)
          DEBUG_show('Normal size', 2)
        else {
          var scale_min = (SL_ST_enabled) ? 0.25 : 0.5
          if (EQP_size_scale == scale_min)
            DEBUG_show('Minimum size', 2)
        }
      }
    }
    else
      DEBUG_show(((EQP_size_scale == 1) ? 'Normal size' : 'Half size'), 2)
  }

  System.Gadget.Settings.writeString("LABEL_EQP_size_scale", ((EQP_size_scale == size_default) ? "" : EQP_size_scale))
}


function EQP_MM_Load(src, para) {
  this.is_video = /\.(wmv|mp4)$/i.test(src)

  if (this.use_Silverlight) {
    if (use_WMP && WMP.in_use)
      WMP.hide()

    var obj
    var w,h
    var x = this.x_default
    var y = this.y_default
    var z = this.z


    if (!para)
      para = { src:src }
    EQP_FilePara(para)

    if (para.w) {
      w = para.w
      if (this.is_video)
        this.w_video = w
    }
    if (para.h) {
      h = para.h
      if (this.is_video)
        this.h_video = h
    }
    if (para.x)
      x = para.x
    if (para.y)
      y = para.y
    if (para.play_sound)
      this.play_sound = true


    var xaml_para = 'Canvas.ZIndex="' + z + '" ' + ((para.opacity == null) ? '' : 'Opacity="' + (para.opacity/100) + '" ');

    var img_id = "main" + z
    var xaml, ext
    if (this.is_video) {
      obj = this.img_obj_v
      if (!obj) {
        var mask = ''
        if (para.mask) {
          mask =
  '<Canvas.OpacityMask>\n'
+ '<ImageBrush x:Name="' + img_id + 'v_mask"  ImageSource="' + toFileProtocol(para.mask) + '"/>\n'
+ '</Canvas.OpacityMask>\n'
        }

        var mask_v = ''
        if (para.mask_v) {
          mask_v =
  '<MediaElement.OpacityMask>\n'
+ '<ImageBrush x:Name="' + img_id + 'v_obj_mask"  ImageSource="' + toFileProtocol(para.mask_v) + '"/>\n'
+ '</MediaElement.OpacityMask>\n'
        }

        xaml =
  '<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + 'v" '
+ xaml_para
+ '>\n'
+ mask
+ '<MediaElement x:Name="' + img_id + 'v_obj" '
+ 'Stretch="UniformToFill" '
+ 'MediaOpened="SL_MediaOpened" MediaEnded="SL_MediaEnded" '
+ ((para.use_media_control) ? 'MouseEnter="SL_Media_MouseEnter" ' : '')
+ '>\n'
+ mask_v
+ '</MediaElement>\n'
+ '</Canvas>'

        ext = 'v'
      }

      w = (this.w_video) ? this.w_video : -1
      h = (this.h_video) ? this.h_video : -1

      if (this.img_obj_i)
        this.img_obj_i.Visibility = "Collapsed"
    }
    else {
      obj = this.img_obj_i
      if (!obj) {
        xaml =
  '<Image xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Name="' + img_id + 'i" '
+ xaml_para
+ '>\n'
+ '</Image>'

        ext = 'i'
      }

      if (!para.w) {
        var dim = loadImageDim(src)
        w = dim.w
        h = dim.h
      }

      if (this.img_obj_v) {
        this.img_obj_v.Visibility = "Collapsed"
        SL_root.FindName(img_id + "v_obj").Stop()
      }
    }

    if (xaml) {
      SL_content.children.add(SL.content.createFromXaml(xaml, false));
      obj = this['img_obj_' + ext] = SL_root.FindName(img_id + ext)
    }

    this.img_obj = obj
    var obj_v = (this.is_video) ? SL_root.FindName(img_id + "v_obj") : obj

    if (this.is_video) {
      if (this.play_sound)
        obj_v.Volume = 1
      obj_v.IsMuted = !this.play_sound
    }

    this.src = src
    this.w_org = w
    this.h_org = h
    this.x_org = x
    this.y_org = y

    obj_v.Source = toFileProtocol(src)
    obj.Visibility = "Visible"

    if (use_EQP_normal)
      this.img = this.img_obj

    EQP_resize(EQP_size_scale, true)
  }
  else {
    if (this.is_video)
      return false

    this.src = src
    this.img_obj.src = (this.use_GADGET_IMG) ? src : toFileProtocol(src)
  }

  return true
}

function EQP_FilePara(obj) {
  if (/\.(wmv|mp4)$/i.test(obj.src))
    obj.is_video = true

  if (!/\.EQP-((bg|main)\d*[_\w+]*)\.\w+$/i.test(obj.src))
    return false

  var para = RegExp.$1
  if (!/(bg|main)/.test(para))
    return false

  obj.type = RegExp.$1
  obj.z = (/(bg|main)(\d+)/i.test(para)) ? parseInt(RegExp.$2) : 0

  if ((obj.type == "main") && /_gimage/i.test(para)) {
    EV_BG_allow_dummy = false
    obj.use_GADGET_IMG = true

    if (use_Silverlight) {
      SL_windowless = true
      SL_ST_enabled = false
    }
  }
  else
    obj.use_Silverlight = use_Silverlight

  if (/_sound/i.test(para))
    obj.play_sound = true
  if (/_mc/i.test(para))
    obj.use_media_control = true

  if (/_x(\d+)y(\d+)/i.test(para)) {
    obj.x = parseInt(RegExp.$1)
    obj.y = parseInt(RegExp.$2)
  }
  if (/_w(\d+)h(\d+)/i.test(para)) {
    obj.w = parseInt(RegExp.$1)
    obj.h = parseInt(RegExp.$2)

    if (obj.is_video) {
      obj.w_video = obj.w
      obj.h_video = obj.h
    }
  }

  if (/_o(\d+)/i.test(para))
    obj.opacity = parseInt(RegExp.$1)

  return true
}


var EQP_parts_path
var EQP_init_extra_default, EQP_dragdrop_target
var EV_SL_MediaOpened_extra

function EQP_DragDrop_Init(ps) {
  EQP_dragdrop_target = ps

  var mask_path = (EQP_parts_path) ? EQP_parts_path + '\\' : 'mask\\';

  var para = ps.dragdrop
  if (para.use_media_control == null)
    para.use_media_control = true
  if (para.play_sound == null)
    para.play_sound = true
  if (para.mask)
    para.mask = Settings.f_path + '\\' + mask_path + para.mask + '.png'
  if (para.mask_v)
    para.mask_v = Settings.f_path + '\\' + mask_path + para.mask_v + '.png'

  if (para.opacity == null)
    para.opacity = (ps.o_min == null) ? null : ps.o_min

  if (EQP_init_extra)
    EQP_init_extra_default = EQP_init_extra

  EQP_init_extra = function () {
    if (EQP_init_extra_default)
      EQP_init_extra_default()

    DragDrop.onDrop_finish = function (item) {
var src = item.path
var para = EQP_dragdrop_target.dragdrop
if (use_WMP && WMP.dragdrop(item, true))
  return
else if (item.isFileSystem && /\.(wmv|mp4)$/i.test(src)) {
  para.src = src
  EQP_dragdrop_target.load(item.path, para)
  if (para.func_extra)
    eval(para.func_extra)
}
else if (!item.isFolder && !DragDrop_RE_default.test(src))
  return
else
  DragDrop_install(item)
    }

    if (para.w && para.h)
      return

    EV_SL_MediaOpened = function (sender, args) {
var obj = EQP_dragdrop_target
var w = (obj.w_video > 0) ? obj.w_video : sender.NaturalVideoWidth
var h = (obj.h_video > 0) ? obj.h_video : sender.NaturalVideoHeight
var stretch = (obj.w_video && obj.h_video) ? "Fill" : "Uniform"

var para = EQP_dragdrop_target.dragdrop
var w_max = para.w_max
var h_max = para.h_max

var scale_w = 1
var scale_h = 1
var scale = 1
if (w > w_max)
  scale_w = w_max / w
if (h > h_max)
  scale_h = h_max / h
scale = (scale_w < scale_h) ? scale_w : scale_h
w = parseInt(w * scale)
h = parseInt(h * scale)

DEBUG_show('Video:'+w+'x'+h+((scale==1)?'':'(resized)'),2)

var use_mask_v = para.mask_v
var img_id = "main" + obj.z + "v"
if (para.mask && para.mask_v) {
  var mask_optimized = para.mask.replace(/\.png$/i, '_'+w+'x'+h+'.png')
  if (ValidatePath(mask_optimized)) {
    SL_root.FindName(img_id + '_mask').ImageSource = toFileProtocol(mask_optimized)
    SL_root.FindName(img_id + '_obj_mask').ImageSource = null
    use_mask_v = false
DEBUG_show("Mask optimized",2)
  }
}
if (use_mask_v)
  SL_root.FindName(img_id + '_obj_mask').ImageSource = toFileProtocol(para.mask_v)


// reset them so that the next video will always load in native resolution by default
obj.w_video = obj.h_video = para.w = para.h = -1

sender.Width  = w
sender.Height = h
sender.Stretch = (para.mask_fixed) ? stretch : "UniformToFill"

var video_align = para.video_align
if (!video_align)
  video_align = "TL"
var video_align_V = video_align.substr(0,1)
var video_align_H = video_align.substr(1,1)
if ((video_align_V == "T") || !h_max)
  sender["Canvas.Top"] = 0
else if (h_max)
  sender["Canvas.Top"] = (h_max - h) * ((video_align_V == "B") ? 1 : 0.5)
if ((video_align_H == "L") || !w_max)
  sender["Canvas.Left"] = 0
else if (w_max)
  sender["Canvas.Left"] = (w_max - w) * ((video_align_H == "R") ? 1 : 0.5)


if (para.mask_fixed) {
  if (w_max)
    w = w_max
  if (h_max)
    h = h_max
}
obj.w_org = w
obj.h_org = h

var x_align = para.x_align
var y_align = para.y_align
if (x_align != null) {
  if (x_align == "center")
    obj.x_org = (EQP_SL_w - w) / 2
  else if (x_align == "right")
    obj.x_org = EQP_SL_w - w
  else if (/^js\:(.+)/i.test(x_align))
    obj.x_org = eval(x_align)
  else
    obj.x_org = parseInt(x_align)
}
if (y_align != null) {
  if (y_align == "center")
    obj.y_org = (EQP_SL_h - h) / 2
  else if (y_align == "bottom")
    obj.y_org = EQP_SL_h - h
  else if (/^js\:(.+)/i.test(y_align))
    obj.y_org = eval(y_align)
  else
    obj.y_org = parseInt(y_align)
}

EQP_dragdrop_target.o_last = -1

resize()

if (EV_SL_MediaOpened_extra)
  EV_SL_MediaOpened_extra()
    }

  }
}

function EQP_Hide_Video() {
  if (!EQP_dragdrop_target || !EQP_dragdrop_target.is_video || !EQP_dragdrop_target.img_obj_i)
    return

  DEBUG_show('(Video End)', 2)

  EQP_dragdrop_target.is_video = false
  SL_root.FindName("C_media_control").Visibility = "Collapsed"
  EQP_dragdrop_target.img_obj_v.Visibility = "Collapsed"
  SL_root.FindName("main" + EQP_dragdrop_target.z + "v_obj").Stop()

  EQP_dragdrop_target.img_obj_i.Visibility = "Visible"

  var para = EQP_dragdrop_target.dragdrop
  if (para.func_extra)
    eval(para.func_extra)
}


// external scripts
if (use_Silverlight && use_WMP) {
  document.write('<script language="JavaScript" src="js/wmp.js"></scr'+'ipt>');
}
else {
// ensure compatibility for no-Silverlight situation
  use_WMP = false
}
