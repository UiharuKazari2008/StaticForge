////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.DOM");
__System.Import("System.Controls.Event");
__System.Import("System.Threading.Monitor");
__System.Import("System.Controls.UI.Components.ImageList");

__System.Controls.UI.Resizer = function(/*String*/ resource)
{
    var __pageName = "Resizer";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __titleBarNode = null;
    var __northNode = null;
    var __eastNode = null;
    var __southNode = null;
    var __westNode = null;
    var __gripNode = null;
    var __gripImageNode = null;
    var __direction = null;
    var __resizeActive = false;
    var __dragActive = false;
    var __dragLocation = { X: null, Y: null };
    var __dragOriginalBounds = { X: null, Y: null, Width: null, Height: null };
    var __gripWidth = null;
    var __gripHeight = null;
    var __prevCursor = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __spacingDefault = 4;
    var __spacingHeight = null;
    var __spacingWidth = null;
    var __titleBarHeight = null;
    var __visible = false;
    var __this = this;
    eval(__controlName + " = this;");
    
    if (resource != null)
    {
        if (__System.Type._IsString(__System.Type.GetTypeCode(resource)))
        {
            __resource.Args[__pageName] = resource;
        }
        else
        {
            __resource.Args[__pageName] = (resource[__pageName] != null ? resource[__pageName] : null);
        }
    }
    
    this.BackColor = null;
    this.BorderSize = 1;
    this.BorderVisible = true;
    this.Created = false;
    this.Draggable = false;
    this.NorthResizable = true;
    this.EastResizable = true;
    this.SouthResizable = true;
    this.WestResizable = true;
    this.Grip = null;
    this.GripDock = null;
    this.Height = null;
    this.ImageList = new __System.Controls.UI.Components.ImageList();
    this.Location = { X: null, Y: null };
    this.MinHeight = null;
    this.MinWidth = null;
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnMove = null;
    this.OnSizeChanged = null;
    this.PageID = null;
    this.Parent = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.RightToLeft = false;
    this.TitleBar = null;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
    
    this.Bounds =
    {
        get: function()
        {
            return { X: __this.Location.X, Y: __this.Location.Y, Width: __this.Width, Height: __this.Height };
        },
        set: function(/*Bounds|Integer*/ x, /*Integer*/ y, /*Integer*/ width, /*Integer*/ height)
        {
            if (x != null && (x.X != null || x.Y != null || x.Width != null || x.Height != null))
            {
                width = x.Width;
                height = x.Height;
                y = x.Y;
                x = x.X;
            }
            
            var xPos = __this.Location.X;
            var yPos = __this.Location.Y;
            
            if (x != null)
            {
                __this.Location.X = __System.Convert.ToInt32(x);
            }
            
            if (y != null)
            {
                __this.Location.Y = __System.Convert.ToInt32(y);
            }
            
            var b = __this.Size.set(width, height, true);
            
            if (__this.Created && (b || xPos != __this.Location.X || yPos != __this.Location.Y))
            {
                ___PositionControl();
            }
        }
    }
    
    this.ControlName =
    {
        get: function()
        {
            return __controlName;
        }
    }
    
    this.Parsing =
    {
        get: function()
        {
            return __resource.Parsing || ___IsChildrenResourceParsing(__resource);
        }
    }
    
    this.Resources =
    {
        get: function()
        {
            return __resources;
        },
        set: function(/*Object*/ obj)
        {
            if (obj != null)
            {
                __resources = obj;
            }
        }
    }
    
    this.Size =
    {
        get: function()
        {
            return { Width: __this.Width, Height: __this.Height };
        },
        set: function(/*Size|Integer*/ size0, /*Integer*/ size1, /*Boolean*/ _calculateSize)
        {
            if (size0 != null && (size0.Width != null || size0.Height != null))
            {
                size1 = size0.Height;
                size0 = size0.Width;
            }
            
            var w = __this.Width;
            var h = __this.Height;
            
            if (size0 != null)
            {
                __this.Width = __System.Convert.ToUInt32(size0);
            }
            
            if (size1 != null)
            {
                __this.Height = __System.Convert.ToUInt32(size1);
            }
            
            if (__this.Created && (w != __this.Width || h != __this.Height))
            {
                if (!_calculateSize)
                {
                    ___PositionControl();
                }
                else
                {
                    return true;
                }
            }
        }
    }
    
    function ___BeginDrag(/*Event*/ evt)
    {
        if (!__resizeActive && ___TryEventMouseClick(__this))
        {
            __dragLocation = __System.Controls.DOM.ConvertPoint(evt);
            __dragOriginalBounds = __this.Bounds.get();
            __dragActive = true;
        }
    }
    
    function ___BeginResize(/*String*/ direction, /*Event*/ evt)
    {
        if (!__dragActive && ___TryEventMouseClick(__this))
        {
            __direction = direction;
            __dragLocation = __System.Controls.DOM.ConvertPoint(evt);
            __dragOriginalBounds = __this.Bounds.get();
            __resizeActive = true;
        }
    }
    
    function ___EndDrag()
    {
        __dragLocation = { X: null, Y: null };
        __dragOriginalBounds = { X: null, Y: null, Width: null, Height: null };
        __dragActive = false;
    }
    
    function ___EndResize()
    {
        if (__prevCursor != null)
        {
            document.body.style.cursor = __prevCursor;
            __prevCursor = null;
        }
        
        __direction = null;
        __dragLocation = { X: null, Y: null };
        __dragOriginalBounds = { X: null, Y: null, Width: null, Height: null };
        __resizeActive = false;
    }
    
    function ___InsertControl()
    {
        var b = (__this.ImageList.Images.Count >= 8);
        var backColor = (__this.BorderVisible ? __this.BackColor : "");
        
        __northNode.innerHTML = '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on">' +
                                '<tr>' +
                                '<td id="' + __controlName + '$North$West" unselectable="on" style="width:' + __this.BorderSize + 'px;height:' + __this.BorderSize + 'px;' + (b || !backColor ? "" : "background-color:" + backColor + ";") + 'white-space:nowrap" nowrap>' + (b ? '<img src="' + __this.ImageList.Images[7] + '" unselectable="on" style="width:' + __this.BorderSize + ';height:' + __this.BorderSize + '" />' : '') + '</td>' +
                                '<td id="' + __controlName + '$North$Center" unselectable="on" style="height:' + __this.BorderSize + 'px;' + (b ? "background:url(" + __this.ImageList.Images[0] + ") repeat-x" : "background-color:" + backColor) + ';white-space:nowrap" nowrap></td>' +
                                '<td id="' + __controlName + '$North$East" unselectable="on" style="width:' + __this.BorderSize + 'px;height:' + __this.BorderSize + 'px;' + (b || !backColor ? "" : "background-color:" + backColor + ";") + 'white-space:nowrap" nowrap>' + (b ? '<img src="' + __this.ImageList.Images[1] + '" unselectable="on" style="width:' + __this.BorderSize + ';height:' + __this.BorderSize + '" />' : '') + '</td>' +
                                '</tr>' +
                                '</table>';
        
        if (__this.NorthResizable)
        {
            if (__this.WestResizable)
            {
                ___SetPageEventHandler(__controlName + "$North$West", "nw");
            }
            
            ___SetPageEventHandler(__controlName + "$North$Center", "n");
            
            if (__this.EastResizable)
            {
                ___SetPageEventHandler(__controlName + "$North$East", "ne");
            }
        }
        
        with (__eastNode)
        {
            innerHTML = '<div id="' + __controlName + '$East$Center" style="width:' + __this.BorderSize + 'px;' + (b ? "background:url(" + __this.ImageList.Images[2] + ") repeat-y" : (backColor ? "background-color:" + backColor : "")) + '">' +
                        '<table cellspacing="0" cellpadding="0" border="0" unselectable="on">' +
                        '<tr>' +
                        '<td id="' + __controlName + '$East$Center$Height" unselectable="on" style="width:' + __this.BorderSize + 'px;font-size:0px">&nbsp;</td>' +
                        '</tr>' +
                        '</div>';
            
            if (__this.EastResizable)
            {
                ___SetPageEventHandler(__controlName + "$East$Center", "e");
            }
        }
        
        __southNode.innerHTML = '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on">' +
                                '<tr>' +
                                '<td id="' + __controlName + '$South$West" unselectable="on" style="width:' + __this.BorderSize + 'px;height:' + __this.BorderSize + 'px;' + (b || !backColor ? "" : "background-color:" + backColor + ";") + 'white-space:nowrap" nowrap>' + (b ? '<img src="' + __this.ImageList.Images[5] + '" unselectable="on" style="width:' + __this.BorderSize + ';height:' + __this.BorderSize + '" />' : '') + '</td>' +
                                '<td id="' + __controlName + '$South$Center" unselectable="on" style="height:' + __this.BorderSize + 'px;' + (b ? "background:url(" + __this.ImageList.Images[4] + ") repeat-x" : "background-color:" + backColor) + ';white-space:nowrap" nowrap></td>' +
                                '<td id="' + __controlName + '$South$East" unselectable="on" style="width:' + __this.BorderSize + 'px;height:' + __this.BorderSize + 'px;' + (b || !backColor ? "" : "background-color:" + backColor + ";") + 'white-space:nowrap" nowrap>' + (b ? '<img src="' + __this.ImageList.Images[3] + '" unselectable="on" style="width:' + __this.BorderSize + ';height:' + __this.BorderSize + '" />' : '') + '</td>' +
                                '</tr>' +
                                '</table>';
        
        if (__this.SouthResizable)
        {
            if (__this.WestResizable)
            {
                ___SetPageEventHandler(__controlName + "$South$West", "sw");
            }
            
            ___SetPageEventHandler(__controlName + "$South$Center", "s");
            
            if (__this.EastResizable)
            {
                ___SetPageEventHandler(__controlName + "$South$East", "se");
            }
        }
        
        with (__westNode)
        {
            innerHTML = '<div id="' + __controlName + '$West$Center" style="width:' + __this.BorderSize + 'px;' + (b ? "background:url(" + __this.ImageList.Images[6] + ") repeat-y" : (backColor ? "background-color:" + backColor : "")) + '">' + 
                        '<table cellspacing="0" cellpadding="0" border="0" unselectable="on">' +
                        '<tr>' +
                        '<td id="' + __controlName + '$West$Center$Height" unselectable="on" style="width:' + __this.BorderSize + 'px;font-size:0px">&nbsp;</td>' +
                        '</tr>' +
                        '</div>';
            
            if (__this.WestResizable)
            {
                ___SetPageEventHandler(__controlName + "$West$Center", "w");
            }
        }
        
        if (__titleBarNode != null)
        {
            with (__titleBarNode)
            {
                style.backgroundImage = "url(" + __System.Convert._IsNullToDefault(__this.TitleBar.BackgroundImage, "") + ")";
                style.backgroundPosition = __System.Convert._IsNullToDefault(__this.TitleBar.BackgroundImageLayout, "");
                style.backgroundRepeat = __System.Convert._IsNullToDefault(__this.TitleBar.BackgroundImageRepeat, "");
                style.overflow = "hidden";
                
                innerHTML = '<table cellspacing="0" cellpadding="' + (__this.TitleBar.Padding != null ? __this.TitleBar.Padding : 0) + '" border="0" unselectable="on"' + (__this.TitleBar.Height != null ? ' style="height:' + __this.TitleBar.Height + 'px"' : '') + '>' +
                            '<tr>' +
                            (__this.TitleBar.Src ? '<td unselectable="on"><img id="' + __controlName + '$TitleBarImage" src="' + __this.TitleBar.Src + '" unselectable="on" /></td>' : '') +
                            '<td id="' + __controlName + '$TitleBarText" unselectable="on" style="font-size:0px;' + (__this.TitleBar.ForeColor != null ? "color:" + __this.TitleBar.ForeColor + ";" : "") + 'white-space:nowrap;overflow:hidden" nowrap>' + (__this.TitleBar.Text != null ? __this.TitleBar.Text : "&nbsp;") + '</td>' +
                            '</tr>' +
                            '</table>';
                
                dir = (__this.TitleBar.RightToLeft ? "rtl" : "");
                
                if (__this.TitleBar.Cursor != null)
                {
                    onmouseenter = function()
                    {
                        if (__direction == null)
                        {
                            __prevCursor = document.body.style.cursor;
                            document.body.style.cursor = __this.TitleBar.Cursor;
                        }
                    }
                    
                    onmouseleave = function()
                    {
                        if (__prevCursor != null && __direction == null)
                        {
                            document.body.style.cursor = __prevCursor;
                            __prevCursor = null;
                        }
                    }
                }
                
                if (__this.Draggable)
                {
                    onmousedown = function()
                    {
                        ___BeginDrag(event);
                        __System.Controls.DOM.CancelEvent(event);
                    }
                }
                else
                {
                    onmousedown = null;
                }
                
                var n = document.getElementById(__controlName + "$TitleBarText").offsetHeight;
                
                if (__this.TitleBar.Height == null)
                {
                    __this.TitleBar.Height = n;
                }
            }
            
            __System.Controls.DOM.ApplyFontStyle(__controlName + "$TitleBarText", __this.TitleBar.Font);
        }
        
        if (__gripNode != null)
        {
            __gripImageNode = document.getElementById(__controlName + "$GripImage");
            
            with (__gripImageNode)
            {
                style.backgroundColor = __System.Convert._IsNullToDefault(__this.Grip.BackColor, "");
                style.backgroundImage = "url(" + __System.Convert._IsNullToDefault(__this.Grip.BackgroundImage, "") + ")";
                style.backgroundPosition = __System.Convert._IsNullToDefault(__this.Grip.BackgroundImageLayout, "");
                style.backgroundRepeat = __System.Convert._IsNullToDefault(__this.Grip.BackgroundImageRepeat, "");
                
                onload = function()
                {
                    __gripWidth = __this.Grip.Width = this.offsetWidth;
                    __gripHeight = (__this.Grip.Height != null ? __this.Grip.Height : this.offsetHeight);
                    
                    __spacingWidth += __gripWidth;
                    __spacingHeight += __gripHeight;
                    
                    __gripNode.style.height = __gripHeight;
                    
                    ___PositionGrip();
                    
                    __System.Controls.DOM.SetVisibility(__gripNode, __visible);
                }
            }
            
            ___SetPageEventHandler(__controlName + "$GripImage", (__this.RightToLeft ? "sw" : "se"));
        }
        
        ___PositionControl();
    }
    
    function ___PositionControl()
    {
        var titleBarHeight = 0;
        
        if (__titleBarNode != null)
        {
            with (__titleBarNode)
            {
                style.width = __this.Width - 2;
                style.left = __this.Location.X + 1;
                style.top = __this.Location.Y - __this.TitleBar.Height + 1;
            }
            
            titleBarHeight = __this.TitleBar.Height;
        }
        
        with (__northNode.style)
        {
            left = __this.Location.X - (__this.BorderSize - 1);
            top = __this.Location.Y - titleBarHeight - (__this.BorderSize - 1);
            width = __this.Width + ((__this.BorderSize - 1) * 2);
            
            document.getElementById(__controlName + "$North$Center").style.width = parseInt(width) - (__this.BorderSize * 2);
        }
        
        with (__westNode.style)
        {
            left = __this.Location.X - (__this.BorderSize - 1);
            top = __this.Location.Y - titleBarHeight + 1;
            height = __this.Height + titleBarHeight - 2;
            
            document.getElementById(__controlName + "$West$Center$Height").style.height = parseInt(height);
        }
        
        with (__southNode.style)
        {
            left = __this.Location.X - (__this.BorderSize - 1);
            top = __this.Location.Y + __this.Height - 1;
            width = __this.Width + ((__this.BorderSize - 1) * 2);
            
            document.getElementById(__controlName + "$South$Center").style.width = parseInt(width) - (__this.BorderSize * 2);
        }
        
        with (__eastNode.style)
        {
            left = __this.Location.X + __this.Width - 1;
            top = __this.Location.Y - titleBarHeight + 1;
            height = __this.Height + titleBarHeight - 2;
            
            document.getElementById(__controlName + "$East$Center$Height").style.height = parseInt(height);
        }
        
        ___PositionGrip();
        
        if (__this.Created)
        {
            var o = __this.Bounds.get();
            
            if (__dragActive)
            {
                if (typeof __this.OnMove == "function")
                {
                    __this.OnMove(o);
                }
            }
            else if (__resizeActive)
            {
                if (!__this.NorthResizable && ((!__this.RightToLeft && !__this.EastResizable) || (__this.RightToLeft && !__this.WestResizable && __this.Grip == null)))
                {
                    o.X = null;
                    o.Y = null;
                }
                
                if (__this.Grip == null && !__this.SouthResizable)
                {
                    o.Height = null;
                }
                
                if (typeof __this.OnSizeChanged == "function")
                {
                    __this.OnSizeChanged(o);
                }
            }
        }
    }
    
    function ___PositionGrip()
    {
        if (__gripNode != null && __gripWidth != null)
        {
            with (__gripNode)
            {
                style.width = __this.Width - 2;
                style.left = __this.Location.X + 1;
                style.top = __this.Location.Y + __this.Height - __gripHeight - 1;
            }
            
            __gripImageNode.style.left = (__this.Grip.RightToLeft ? 0 : __this.Width - __gripWidth - 2);
        }
    }
    
    function ___ProcessDrag(/*Event*/ evt)
    {
        var p = __System.Controls.DOM.ConvertPoint(evt);
        
        __this.Location.X = __dragOriginalBounds.X + (p.X - __dragLocation.X); 
        __this.Location.Y = __dragOriginalBounds.Y + (p.Y - __dragLocation.Y);
        
        ___PositionControl();
    }
    
    function ___ProcessResize(/*Event*/ evt)
    {
        var p = __System.Controls.DOM.ConvertPoint(evt);
        
        var x = 0;
        var y = 0;
        var w = 0;
        var h = 0;
        
        var xOffset = p.X - __dragLocation.X;
        var yOffset = p.Y - __dragLocation.Y;
        
        for (var i = 0; i < __direction.length; i++)
        {
            switch (__direction.charAt(i))
            {
                case "n":
                    y = yOffset;
                    h = -yOffset;
                    break;
                case "s":
                    h = yOffset;
                    break;
                case "w":
                    x = xOffset;
                    w = -xOffset;
                    break;
                case "e":
                    w = xOffset;
                    break;
            }
        }
        
        var minWidth = (__this.MinWidth != null ? __this.MinWidth : __spacingWidth);
        var minHeight = (__this.MinHeight != null ? __this.MinHeight : __spacingHeight);
        
        w += __dragOriginalBounds.Width;
        
        if (w > minWidth)
        {
            __this.Location.X = __dragOriginalBounds.X + x;    
            __this.Width = w;
        }
        else if (__this.Width != minWidth)
        {
            if (__direction.indexOf("w") != -1)
            {
                __this.Location.X += (__this.Width - minWidth);
            }
            
            __this.Width = minWidth;
        }
        
        h += __dragOriginalBounds.Height;
        
        if (h > minHeight)
        {
            __this.Location.Y = __dragOriginalBounds.Y + y;
            __this.Height = h;
        }
        else if (__this.Height != minHeight)
        {
            if (__direction.indexOf("n") != -1)
            {
                __this.Location.Y += (__this.Height - minHeight);
            }
            
            __this.Height = minHeight;
        }
        
        ___PositionControl();
    }
    
    function ___SetPageEventHandler(/*String*/ element, /*String*/ direction)
    {
        with (document.getElementById(element))
        {
            onmouseenter = function()
            {
                if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) && __direction == null)
                {
                    __prevCursor = document.body.style.cursor;
                    document.body.style.cursor = direction + "-resize";
                }
            }
            
            onmouseleave = function()
            {
                if (__prevCursor != null && __direction == null)
                {
                    document.body.style.cursor = __prevCursor;
                    __prevCursor = null;
                }
            }
            
            onmousedown = function()
            {
                ___BeginResize(direction, event);
            }
        }
    }
    
    this.Remove = function()
    {
        __System.Controls.DOM.Remove(__titleBarNode);
        __System.Controls.DOM.Remove(__northNode);
        __System.Controls.DOM.Remove(__eastNode);
        __System.Controls.DOM.Remove(__southNode);
        __System.Controls.DOM.Remove(__westNode);
        __System.Controls.DOM.SetVisibility(__gripNode);
        
        this.Created = false;
    }
    
    this.Show = function(/*Boolean*/ isVisible)
    {
        // summary:
        //   User procedure to make the control visible.
        //
        // arguments:
        //   isVisible (optional)
        //
        // returns: Nothing
        
        if (this.Created)
        {
            __visible = (isVisible == null || isVisible);
            
            __System.Controls.DOM.SetVisibility(__titleBarNode, __visible);
            __System.Controls.DOM.SetVisibility(__northNode, __visible);
            __System.Controls.DOM.SetVisibility(__eastNode, __visible);
            __System.Controls.DOM.SetVisibility(__southNode, __visible);
            __System.Controls.DOM.SetVisibility(__westNode, __visible);
            
            if (__gripImageNode != null && __gripImageNode.offsetWidth > 0)
            {
                __System.Controls.DOM.SetVisibility(__gripNode, __visible);
            }
            
            this.Visible = __visible;
        }
    }
    
    this.Load = function(/*Boolean*/ bypassLoad)
    {
        // summary:
        //   User procedure to initiate the control.
        //
        // arguments:
        //   bypassLoad (optional)
        //
        // returns: Nothing
        
        if (___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback) && !bypassLoad)
        {
            if (!__System.IsFrameworkLoaded() || this.Parsing.get())
            {
                setTimeout(__controlName + ".Load()");
            }
            else
            {
                if (this.Parent == null || this.Parent.Created)
                {
                    __pageNode = document.getElementById(this.PageID);
                    
                    if (__pageNode != null)
                    {
                        if (typeof this.OnBeforeLoad == "function")
                        {
                            this.OnBeforeLoad(this);
                        }
                        
                        __spacingWidth = __spacingDefault;
                        __spacingHeight = __spacingDefault;
                        
                        var p = __System.Controls.DOM.Bounds(__pageNode, true);
                        
                        this.Location = { X: p.X, Y: p.Y };
                        this.Width = p.Width;
                        this.Height = p.Height;
                        this.ZIndex = (this.ZIndex != null ? this.ZIndex : parseInt(__pageNode.style.zIndex) + 1);
                        
                        __northNode = __System.Controls.DOM.Append({
                                                                     ID: __controlName + "$North",
                                                                     Visibility: false,
                                                                     ZIndex: this.ZIndex
                                                                   });
                        
                        __westNode = __System.Controls.DOM.Append({
                                                                    ID: __controlName + "$West",
                                                                    Visibility: false,
                                                                    ZIndex: this.ZIndex
                                                                  });
                        
                        __southNode = __System.Controls.DOM.Append({
                                                                     ID: __controlName + "$South",
                                                                     Visibility: false,
                                                                     ZIndex: this.ZIndex
                                                                   });
                        
                        __eastNode = __System.Controls.DOM.Append({
                                                                    ID: __controlName + "$East",
                                                                    Visibility: false,
                                                                    ZIndex: this.ZIndex
                                                                  });
                        
                        if (this.TitleBar != null)
                        {
                            __titleBarNode = __System.Controls.DOM.Append({
                                                                            ID: __controlName + "$TitleBar",
                                                                            Height: __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.TitleBar.Height), ""),
                                                                            BackColor: __System.Convert._IsNullToDefault(this.TitleBar.BackColor, ""),
                                                                            Visibility: false,
                                                                            ZIndex: (this.TitleBar.ZIndex != null ? this.TitleBar.ZIndex : this.ZIndex)
                                                                          });
                            
                            __spacingWidth = 2;
                            __spacingHeight = 2;
                        }
                        else if (__titleBarNode != null)
                        {
                            __System.Controls.DOM.Remove(__titleBarNode);
                            
                            __titleBarNode = null;
                            __titleBarHeight = null;
                        }
                        
                        if (this.Grip != null)
                        {
                            __gripNode = __System.Controls.DOM.Append({
                                                                          ID: __controlName + "$Grip",
                                                                          Height: __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Grip.Height), ""),
                                                                          Visibility: false,
                                                                          Overflow: "hidden",
                                                                          Html: '<img id="' + __controlName + '$GripImage" src="' + this.Grip.Src + '" unselectable="on" style="position:absolute;top:0px" />',
                                                                          ZIndex: (this.Grip.ZIndex != null ? this.Grip.ZIndex : this.ZIndex)
                                                                        });
                            
                            __spacingWidth = 2;
                            __spacingHeight = 2;
                        }
                        else if (__gripNode != null)
                        {
                            __System.Controls.DOM.Remove(__gripNode);
                            
                            __gripNode = null;
                            __gripImageNode = null;
                            __gripWidth = null;
                            __gripHeight = null;
                        }
                        
                        ___InsertControl();
                        
                        this.Created = true;
                        
                        this.Show();
                        
                        if (typeof this.OnAfterLoad == "function")
                        {
                            this.OnAfterLoad(this);
                        }
                    }
                }
            }
        }
    }
    
    this._EVENTS =
    {
        MouseMove: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for mousemove.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (required)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseMove) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (__dragActive)
                    {
                        ___ProcessDrag(evt);
                    }
                    else if (__resizeActive)
                    {
                        ___ProcessResize(evt);
                    }
                }
            }
        },
        MouseUp: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for mouseup.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (required)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseUp) == __this))
                {
                    evt = (evt != null ? evt : event);
                
                    if (__dragActive)
                    {
                        ___EndDrag(evt);
                    }
                    else if (__resizeActive)
                    {
                        ___EndResize(evt);
                    }
                    
                    ___RemoveEventMouseClick(__this);
                }
            }
        }
    }
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);
    
    __System.Controls.Event.Add(this, __System.Controls.EventType.MouseMove);
}

if (typeof Resizer == "undefined")
{
    Resizer = __System.Controls.UI.Resizer;
}

__System.Import("System.Controls.UI.Resizer", true);
