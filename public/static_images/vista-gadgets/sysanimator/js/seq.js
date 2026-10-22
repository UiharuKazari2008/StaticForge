// Sequencer emulation 3.2.1
// Copyright (c) 1997-2010 Butz Yung. All rights reserved.
// Do NOT copy or modify any part of the script without permission.
// All comments and notice must be left as is.
// Homepage: http://www.animetheme.com

var seq_items = []
var Seq_HT_enabled

function Seq_object() {
  this.item = Seq_item

  this.JS_timer_used = []
  this.JS_timer_active = []
  this.setInterval = Seq_setInterval
  this.clearInterval = Seq_clearInterval
  this.clearTimeout = Seq_clearInterval
}

function Seq_item(str) {
  if (!seq_items[str])
    seq_items[str] = new Seq_core(str)
  return seq_items[str]
}

function Seq_core(str) {
  this.name = str
  this.count = 0
  this.At = Seq_at
  this.Play = Seq_play
  this.Stop = Seq_stop
  this.Pause = Seq_pause
  this.exec = Seq_exec
}

function Seq_at(init_delay, func, max_count, interval) {
  this.initialized = true

  this.init_delay = parseInt(init_delay * 1000) + 1
  this.func = (func.constructor == String) ? (new Function(func + ((/^\s*\w+$/.test(func)) ? "()" : ""))) : func
  this.max_count = max_count
  this.interval = this.interval_current = parseInt(interval * 1000)

  this.update_time_last = 0
}

function Seq_play() {
  if (!this.initialized || !self.loaded)
    return

  this.paused = false

  if (this.count) {
    if (this.timerID)
      return

    if (Seq_HT_enabled) {
      var t = this.HT_obj
      t.seekSegmentTime(t.currTimeState.segmentDur)
      t.resumeElement()
    }
    else
      seq_items[this.name].exec()
  }
  else {
    if (Seq_HT_enabled) {
      var t
      if (this.HT_obj) {
        t = this.HT_obj
        t.dur = this.init_delay + "ms"
        t.seekSegmentTime(0)
        t.resumeElement()
      }
      else {
        t = this.HT_obj = document.createElement("div")
        t.style.display = "none"
        t.className = "time"
        t.begin = this.init_delay + "ms"
        t.dur = this.interval + "ms"
        t.repeatCount = "indefinite"
        eval('t.onbegin = t.onrepeat = function () { seq_items["' + this.name + '"].exec() }')

        document.body.appendChild(t)
      }

      this.timerID = this.init_delay + "ms"
    }
    else {
      if (this.timerID)
        clearTimeout(this.timerID)

      this.timerID = setTimeout('seq_items["' + this.name + '"].exec()', this.init_delay)
    }
  }
}

var Seq_interval_current_min = 10

function Seq_exec() {
  if (this.paused)
    return
  if (this.count++ == this.max_count) {
    this.Stop()
    return
  }

  if (Seq_HT_enabled)
    this.timerID = this.HT_obj.dur = this.interval + "ms"
  else {
    var t = new Date().getTime()
    var t_last = this.update_time_last
    var t_current = this.interval_current

//DEBUG_show(t_current)

    this.interval_current = null
    if ((this.interval > Seq_interval_current_min) && (t_last > 0)) {
      var t_real = (t - t_last) - t_current
      if (t_real > 0) {
        t_current = this.interval - t_real
        if (t_current < Seq_interval_current_min)
          t_current = Seq_interval_current_min
        this.interval_current = t_current
      }
    }
    this.update_time_last = t
    if (this.interval_current == null)
      this.interval_current = this.interval

    this.timerID = setTimeout('seq_items["' + this.name + '"].exec()', this.interval_current)
  }

  this.func()
}

function Seq_stop() {
  this.Pause()
  this.count = 0
  if (Seq.onstop)
    Seq.onstop(this.name)
}

function Seq_pause() {
  this.paused = true

  if (!this.timerID)
    return

  if (Seq_HT_enabled)
    this.HT_obj.pauseElement()
  else
    clearTimeout(this.timerID)

  this.timerID = null
}

// For simple setInterval/setTimeout support

function Seq_setInterval(func, ms) {
  var timer_num = -1
  for (var i = 0; i < this.JS_timer_used.length; i++) {
    if (!this.JS_timer_used[i]) {
      timer_num = i
      break
    }
  }
  if (timer_num == -1)
    timer_num = this.JS_timer_used.length

  var d = new Date();
  var timerID = "T" + d.getTime()
  while (this.JS_timer_active[timerID]) {
    timerID += "-0"
  }

  this.JS_timer_active[timerID] = timer_num + 1
  this.JS_timer_used[timer_num] = true

  ms /= 1000
  var s = Seq.item("JS-timer" + timer_num)
  s.At(ms, func, -1, ms)
  s.Play()

DEBUG_show('SI:' + timer_num, 2)
  return timerID
}

function Seq_clearInterval(timerID) {
  var timer_num = this.JS_timer_active[timerID]
  if (!timer_num) {
    return
  }

  timer_num--
  this.JS_timer_active[timerID] = null
  this.JS_timer_used[timer_num] = null

  Seq.item("JS-timer" + timer_num).Stop()

DEBUG_show('CI:' + timer_num, 2)
}

// END

var Seq, SeqOBJ
Seq = SeqOBJ = new Seq_object()
