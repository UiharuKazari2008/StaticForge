var EV_width, EV_height

var EV_init = function () {
  BG.removeObjects()
  var bg_shadow = BG.addImageObject(Settings.f_path + "\\images\\bg.gif", 0,0)
  bg_shadow.addShadow("black", 3, 75, 3,3)

  EV_width = 240+5
  EV_height = 100+5
}
