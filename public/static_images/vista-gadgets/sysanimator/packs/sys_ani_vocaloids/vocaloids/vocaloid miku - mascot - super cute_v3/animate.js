// Miku deluxe (v1.5.1)

//  SA defaults
var EV_init
var EV_width, EV_height
var EV_BG_src
var EV_animate_full
// END


var Miku = {
   init: function () {
//DEBUG_show(123)

this.parts = {
   arm_left: new this.createPart(["_01_237x176","_02_168x176","_03_200x178","_04_163x177","_05_162x178","_06_163x178","_07_171x256"])
  ,mic: new this.createPart(["_big_242x202","_small_229x208","_negi_255x235"])
  ,option: new this.createPart(["_sweats_155x314"], true)
  ,arm_right: new this.createPart(["_01_250x175","_02_282x176","_03_217x188","_04_301x250"])
  ,eyebrows: new this.createPart(["_01_213x273","_troubled_212x272","_angry_211x269"])
  ,blush: new this.createPart(["_01_223x215","_02_225x225"], true)
  ,eyes: new this.createPart(["_02_222x262","_shy01_222x262","_shy02_222x262","_smile_222x262","_speechless_222x262","_stress_222x262","_wink02_222x262","_closed_220x225"])
  ,mouth: new this.createPart(["_a_195x214","_i_195x214","_u_195x214","_e_195x214","_o_195x214","_wa_195x214", "_smile_195x214","_kitty_195x214","_sad_195x214"], true)
  ,body: new this.createPart(["_main"])
}


// Main
this.initialized = true

document.body.title = "Miku: ...... >_<"
document.onmouseover = function () { Miku.mouseOver() }
document.onmouseout  = function () { Miku.mouseOut() }
document.ondblclick  = function () { Miku.switchMic() }

BG.removeObjects()

var parts = ["body","mouth","eyes","blush","eyebrows","arm_right","option","mic","arm_left"]
this.parts_name = parts
for (var i = 0; i <  parts.length; i++) {
  var name = parts[i]
  var part = this.parts[name]

  for (var k in part.objs) {
    var para = part.objs_para[k]

    var img = BG.addImageObject(Settings.f_path + '\\parts\\' + (name + para.name_org) + '.png', 0,0)
    img.opacity = (k == part.part_default) ? 100 : 0

    var w = img.width
    var h = img.height

    para.img = img
    para.w = w
    para.h = h

    part.objs[k] = this.imgObjs.length
    this.imgObjs.push(img)
  }

  part.obj_last = (part.part_default == -1) ? -1 : part.objs[part.part_default]
}

this.parts.eyes.set_blink = function (extra_delay) {
  if (!extra_delay)
    extra_delay = 0

  this.action_count = 10 * (random(4) + 1 + extra_delay)
}
   }

  ,resize: function () {
var f = (System.Gadget.docked) ? 0.5 : 1;

EV_width  = this.width * f
EV_height = this.height * f

var parts = this.parts_name
for (var i = 0; i <  parts.length; i++) {
  var name = parts[i]
  var part = this.parts[name]

  for (var k in part.objs) {
    var para = part.objs_para[k]
    var img = para.img

    var w = para.w * f
    var h = para.h * f
    img.left = (w - para.w)/2 + para.x * f
    img.top  = (h - para.h)/2 + para.y * f
    img.width  = w
    img.height = h
  }
}

EV_BG_src = "";
BG.style.pixelWidth = EV_width;
BG.style.pixelHeight = EV_height;
   }

  ,createPart: function (parts, hidden_by_default) {
var objs = {}
var objs_para = {}
for (var i = 0; i <  parts.length; i++) {
  var p = parts[i]

  var x = 0
  var y = 0
  var name_org = p
  if (/_(\d+)x(\d+)$/.test(p)) {
    x = Miku.width  - parseInt(RegExp.$1)
    y = Miku.height - parseInt(RegExp.$2)
    p = p.replace(/_(\d+)x(\d+)$/, "")
  }

  var para = {name_org:name_org, x:x, y:y}
  objs_para[p] = para

  objs[p] = -1

  if (i == 0)
    this.part_default = (hidden_by_default) ? -1 : p
}
this.objs = objs
this.objs_para = objs_para

this.obj_last = -1
this.action_count = 0
this.locked = 0
   }

  ,show: function (p, obj, lock_lvl) {
if (!lock_lvl)
  lock_lvl = 99

var part = this.parts[p]
if (part.locked >= lock_lvl)
  return false

var p
if (obj) {
  p = part.objs[obj]
  if (part.obj_last == p)
    return false
}

if (part.obj_last != -1)
  Miku.imgObjs[part.obj_last].opacity = 0
if (!obj) {
  part.obj_last = -1
  return false
}

Miku.imgObjs[p].opacity = 100
part.obj_last = p
part.locked = 0

return true
   }

  ,switchMic: function () {
var mic = this.parts.mic
if (!mic.objs_array) {
  mic.objs_array = []
  for (var i in mic.objs)
    mic.objs_array.push(i)  
}

mic.action_count++
if (mic.action_count >= mic.objs_array.length)
  mic.action_count = 0

this.show("mic", mic.objs_array[mic.action_count])

this.mouseover_lvl = 9
this.mouseOver_Process()
   }

  ,mouseOver: function () {
document.body.style.cursor = "pointer"
if (this.mouseover_lvl)
  return

this.mouseover_lvl = 1
this.mouseOver_Process()
   }

  ,mouseOut: function () {
document.body.style.cursor = "default"
this.mouseover_lvl = 0

this.show("eyebrows", "_01")
this.show("blush")
this.show("option")

var eyes = Miku.parts.eyes
eyes.action_count = 0
eyes.locked = 0
   }

  ,mouseOver_Process: function () {
var lvl = this.mouseover_lvl
if (!lvl)
  return

if (lvl <= 2) {
  this.show("eyebrows", "_troubled")
  this.show("blush", "_01")
  this.show("eyes", "_shy01")
}
else if (lvl <= 3) {
  this.show("eyebrows", "_troubled")
  this.show("blush", "_02")
  this.show("eyes", "_shy02")
}
else if (lvl <= 4) {
  this.show("eyebrows", "_angry")
  this.show("blush", "_02")
  this.show("eyes", "_speechless")
  Miku.parts.eyes.locked = 1

  this.show("mouth", "_sad", 1)
}
else if (lvl <= 5) {
  this.show("eyebrows", "_angry")
  this.show("blush", "_02")
  this.show("eyes", "_stress")
  Miku.parts.eyes.locked = 1

  this.show("mouth", "_sad", 1)
}
else {
  this.show("eyebrows", "_angry")
  this.show("blush", "_02")
  this.show("eyes", "_stress")
  Miku.parts.eyes.locked = 1

  this.show("mouth", "_sad", 1)
  this.show("option", "_sweats")
}
   }

// Actions START
  ,actions: null

  ,actions_normal: [
/*
 [ { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_05"}, {id:"arm_right", p:"_02"} ] }, { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_07"}, {id:"arm_right", p:"_04"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_07"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_04"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_04"} ] } ]
,*/

 [ { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_02"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_03"}, {id:"arm_right", p:"_03"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_03"}, {id:"arm_right", p:"_02"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_03"}, {id:"arm_right", p:"_01"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_03"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_01"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_05"}, {id:"arm_right", p:"_02"} ] } ]
//,[ { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_06"}, {id:"arm_right", p:"_04"} ] }, { objs:[ {id:"arm_left", p:"_02"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_07"}, {id:"arm_right", p:"_02"} ] } ]
   ]

  ,actions_stressed: [
 [ { objs:[ {id:"arm_left", p:"_03"}, {id:"arm_right", p:"_04"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_04"} ] } ]
//,[ { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_01"} ] }, { objs:[ {id:"arm_left", p:"_04"}, {id:"arm_right", p:"_04"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_07"}, {id:"arm_right", p:"_04"} ] } ]
,[ { objs:[ {id:"arm_left", p:"_07"}, {id:"arm_right", p:"_03"} ] } ]
   ]
// END

  ,width: 330
  ,height: 320

  ,imgObjs: []

  ,action_default: [{ objs:[ {id:"arm_left", p:"_01"}, {id:"arm_right", p:"_01"} ] }]
  ,action_index: -1
  ,action_count: 0
  ,action_duration: 0

  ,frame_duration_default: 2

  ,mouseover_lvl: 0

  ,stress: 0
  ,stress_limit: 150

  ,idle_lvl: 0
  ,idle_count: 9

  ,objs_for_clear: []
}

EV_init = function () {
  if (Miku.initialized)
    Miku.resize()
  else {
    Miku.init()
    Miku.resize()
  }
}

EV_animate_full = function () {
  for (var i = 0; i < Miku.objs_for_clear.length; i++)
    Miku.show(Miku.objs_for_clear[i])
  Miku.objs_for_clear = []

  var eyes = Miku.parts.eyes
  var action, action_count
  if (EV_usage <= Miku.idle_lvl) {
    if (++Miku.idle_count >= 10) {
      if (Miku.idle_count == 10)
        eyes.action_count = 0

      action = Miku.action_default
      action_count = 0
    }
  }
  else {
    if (Miku.idle_count)
      eyes.action_count = 0

    Miku.idle_count = 0
  }

  if (--eyes.action_count == 0) {
    Miku.show("eyes", "_closed", 1)
    if (Miku.mouseover_lvl)
      Miku.mouseover_lvl++
  }
  else if (Miku.mouseover_lvl && (eyes.action_count < 0)) {
    Miku.mouseOver_Process()
    eyes.set_blink()
  }

  if (!action) {
// Stress
    var stress = Miku.stress
    var stress_limit = Miku.stress_limit
    var mod = 0
    if (EV_usage_float < 50)
      mod = -20
    else if (EV_usage_float < 80)
      mod = -10
    else if (EV_usage_float < 99)
      mod = 10
    else
      mod = 20

    stress += mod

    if (stress < 0)
      stress = 0
    else if (stress >= stress_limit) {
      if (stress <= stress_limit+10) {
        if (mod > 0)
          stress += 100
        else {
          stress -= 100
          if (!Miku.mouseover_lvl)
            Miku.show("eyes", "_02")
        }
      }
      else if (stress > stress_limit+100)
        stress = stress_limit+100
    }

    Miku.stress = stress
//DEBUG_show(stress)


    if (Miku.action_index == -1) {
      Miku.actions = ((stress < stress_limit/2) || (Math.random()+((stress>=stress_limit)?0.25:0) < 0.5)) ? Miku.actions_normal : Miku.actions_stressed
      Miku.action_index = random(Miku.actions.length)
      Miku.action_count = 0

      action = Miku.actions[Miku.action_index]
      var dur = 0
      for (var i = 0; i < action.length; i++)
        dur += (action[i].duration) ? action[i].duration : Miku.frame_duration_default
      Miku.action_duration = 10 * (random(3+1) + 3) * (action.length/dur)
    }
    else
      action = Miku.actions[Miku.action_index]

    action_count = parseInt(Miku.action_count) % action.length


// Eyes
if (!Miku.mouseover_lvl) {
  if (stress < 20) {
    Miku.show("eyebrows", "_01")
    Miku.show("blush")
  }
  else if ((stress > stress_limit-50) && (stress < stress_limit)) {
    Miku.show("eyebrows", "_angry")
    Miku.show("blush", "_01")
  }
  else if (stress >= stress_limit) {
    Miku.show("eyes", "_stress")
    eyes.locked = 1

    Miku.show("eyebrows", "_troubled")
    Miku.show("blush", "_02")
  }

  if (eyes.action_count < 0) {
    var extra_delay = 0

    var seed = Math.random()
    if ((seed < 0.8) || (stress > stress_limit/2)) {
      Miku.show("eyes", "_02", 1)
    }
    else {
      Miku.show("eyes", "_closed")
      extra_delay = 4
    }

    eyes.set_blink(extra_delay)
  }
}


// Sing
    var mouth = Miku.parts.mouth
    mouth.action_count += 0.1 + 0.9 * (EV_usage_float / 100)
    if (mouth.action_count > 1) {
      mouth.action_count--
      var mouth_shapes = ["_a","_i","_u","_e",((EV_usage+random(100)>125) ? "_wa" : "_o")]
      var mouth_shape = mouth_shapes[random(mouth_shapes.length)]

      Miku.show("mouth", mouth_shape)
      mouth.locked = 1
    }
  }
  else {

// Eyes
if (!Miku.mouseover_lvl) {
  if (eyes.action_count < 0) {
    var extra_delay = 0
    var seed = Math.random()
    if (seed < 0.6) {
      Miku.show("eyes", "_02")
      Miku.show("mouth")
    }
    else {
      if (seed < 0.8) {
        Miku.show("eyes", "_smile")
        eyes.locked = 1
      }
      else
        Miku.show("eyes", "_wink02")
      Miku.show("mouth", ((Math.random() < 0.6) ? "_smile" : "_kitty"))
      extra_delay = 2
    }

    eyes.set_blink(extra_delay)
  }
}

  }

  var frame = action[action_count]
  var objs = frame.objs
  var objs_for_clear = []
  for (var i = 0; i < objs.length; i++) {
    var obj = objs[i]

    if (Miku.show(obj.id, obj.p))
      objs_for_clear.push(obj.id)
  }

  var duration = (frame.duration) ? frame.duration : Miku.frame_duration_default
  var count = 0.1 + 0.9 * (EV_usage_float / 100)

  Miku.action_count += count / duration
  if (parseInt(Miku.action_count) >= Miku.action_duration) {
    Miku.action_index = -1
    Miku.objs_for_clear = objs_for_clear
  }
}


if (use_EQP_fireworks) {
  var CanvasEffect_options = {
  start_x: -0.1
 ,start_y: -0.3

 ,vector_z_func: function () { return (Math.random() * -10) }

 ,icon: 1
  }
}
