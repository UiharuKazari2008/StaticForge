// v1.2.0
// BG gallery START

var MMG_gallery_count = -1
var MMG_BG
var MMG_BG_count = -1
var MMG_BG_scroll_length = 100
var MMG_BG_idle_length = 20
var MMG_BG_opacity_base = 100
var MMG_BG_width = 130
var MMG_BG_height = 130
var MMG_BG_bounding_width = 256
var MMG_BG_bounding_height = 256
var MMG_BG_x_mod, MMG_BG_y_mod
var MMG_BG_x_org, MMG_BG_y_org

if (!BG_dim_calculate)
  BG_dim_calculate = function () { EV_width=MMG_BG_width; EV_height=MMG_BG_height; }

function MMG_drawBG() {
  if (!MMG_gallery.length)
    return

  if (++MMG_BG_count >= MMG_BG_scroll_length + MMG_BG_idle_length)
    MMG_BG_count = 0

  if (MMG_BG_count == 0) {
    var shuffle_mode = (MMG_gallery.length < 100)
    if (shuffle_mode) {
      if (++MMG_gallery_count >= MMG_gallery.length)
        MMG_gallery_count = 0

      if (MMG_gallery_count == 0)
        MMG_gallery.sort(sort_random)
    }
    else
      MMG_gallery_count = random(MMG_gallery.length)


    MMG_BG = MMG_gallery[MMG_gallery_count]
    if (!MMG_BG.w && !MMG_BG.h) {
      var w,h
      var dim = loadImageDim(MMG_BG.path)
      w = dim.w
      h = dim.h

      if ((w > MMG_BG_width * 3) || (h > MMG_BG_height * 3)) {
        var w_ratio = MMG_BG_bounding_width / w
        var h_ratio = MMG_BG_bounding_height / h
        var ratio = (w_ratio < h_ratio) ? w_ratio : h_ratio
        if (w * ratio < MMG_BG_width)
          ratio = MMG_BG_width / w
        if (h * ratio < MMG_BG_height)
          ratio = MMG_BG_height / h

        w = Math.round(w * ratio)
        h = Math.round(h * ratio)

//        if ((w <= 256) && (h <= 256))
        MMG_BG.path_file = "gimage:///" + MMG_BG.path + "?width=" + w + "&height=" + h
      }

      MMG_BG.w = w
      MMG_BG.h = h
    }


    MMG_BG_x_mod = (Math.random() > 0.5) ? 1 : -1
    MMG_BG_y_mod = (Math.random() > 0.5) ? 1 : -1

    IMMG.src = MMG_BG.path_file
    var s = IMMG.style
    s.posLeft = MMG_BG_x_org = (MMG_BG_x_mod < 0) ? 0 : MMG_BG_width - MMG_BG.w
    s.posTop = MMG_BG_y_org = (MMG_BG_y_mod < 0) ? 0 : MMG_BG_height - MMG_BG.h
  }

  if (MMG_BG_count < MMG_BG_idle_length) {
    IMMG.filters[0].opacity = 0
    return
  }

  var count = MMG_BG_count - MMG_BG_idle_length
  var target_opacity = MMG_BG_opacity_base

  if (count < 10) {
    var p = count / 10
    IMMG.filters[0].opacity = parseInt(p * target_opacity)

    if (count == 1) {
      if (self.EV_MMG_refresh)
        EV_MMG_refresh()
    }
  }
  else if (count >= MMG_BG_scroll_length - 10) {
    var p = 1 - (count - (MMG_BG_scroll_length - 10)) / 10
    IMMG.filters[0].opacity = parseInt(p * target_opacity)
  }
  else
    IMMG.filters[0].opacity = target_opacity

  var p = count / MMG_BG_scroll_length
  var s = IMMG.style
  s.posLeft = MMG_BG_x_org + parseInt(p * (MMG_BG.w - MMG_BG_width) * MMG_BG_x_mod)
  s.posTop = MMG_BG_y_org + parseInt(p * (MMG_BG.h - MMG_BG_height) * MMG_BG_y_mod)
}

function MMG_dragdrop_gallery(item) {
  System.Gadget.Settings.writeString("MMG_Gallery_Path", item.path)

  setTimeout('self.location.href = self.location.href', 0)
}

var MMG_gallery = []
MMG_LoadGallery()

function MMG_LoadGallery() {
  var f

  try {
    f = System.Shell.itemFromPath(Settings.f_path + "\\bg")
  }
  catch (ex) {}

  if (!f)
    return

  var g_path = System.Gadget.Settings.readString("MMG_Gallery_Path")
  if (g_path)
    MMG_gallery = Shell_ReturnItemsFromFolder(g_path)

  if (!MMG_gallery.length)
    MMG_gallery = Shell_ReturnItemsFromFolder(Settings.f_path + "\\bg")
}


if (ValidatePath(Settings.f_path + '\\mmg_option.js'))
  document.write('<script language="JavaScript" src="' + toFileProtocol(Settings.f_path + '\\mmg_option.js') + '"></scr'+'ipt>')
