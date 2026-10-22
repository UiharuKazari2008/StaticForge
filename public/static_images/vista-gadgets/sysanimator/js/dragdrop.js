// Drag drop (v1.0.0)

var DragDrop = {
  init: function (obj, ondrop_finish, validate_func) {
    obj.ondragenter = function () { DragDrop.onDragEnter() }
    obj.ondragover  = function () { DragDrop.onDragOver() }
    obj.ondrop      = function () { DragDrop.onDrop() }

    this.onDrop_finish = ondrop_finish

    this.validate_func = (validate_func) ? validate_func : function (item) { return item.isFolder }
  }

  ,validateDropItem: function (dataTransfer) {
    try {
      var item = System.Shell.itemFromFileDrop(dataTransfer, 0);
      return this.validate_func(item);
    }
    catch (ex) {
      return false;
    }
  }

  ,_dragAccepted: false

  ,onDragEnter: function () {
    event.returnValue = false;

    if (this.validateDropItem(event.dataTransfer)) {
      event.dataTransfer.dropEffect = "link";
      this._dragAccepted = true;
    }
    else {
      event.dataTransfer.dropEffect = "none";
      this._dragAccepted = false;
    }
  }
    
  ,onDragOver: function () {
    if (this._dragAccepted) {
      event.returnValue = false;
      event.dataTransfer.dropEffect = "link";
    }
  }
    
  ,onDrop: function () {
    event.returnValue = false;

    var item = System.Shell.itemFromFileDrop(event.dataTransfer, 0);
    if (item == null) return;

    this.onDrop_finish(item)
  }
}
