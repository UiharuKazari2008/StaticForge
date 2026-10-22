////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.DOM");
__System.Import("System.Controls.Event");
__System.Import("System.Collections.Generic.List");
__System.Import("System.Threading.Monitor");

__System.Controls.UI.ScrollBar = function(/*String*/ resource)
{
    var __pageName = "ScrollBar";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __contentNode = null;
    var __scrollNode = null;
    var __arrowsIncrement = 6;
    var __arrowsSpeed = 50;
    var __controlEvents = [];
    var __dragActive = false;
    var __dragDistance = 0;
    var __dragLocation = { X: null, Y: null };
    var __fadeBypassPhase = "2-3,3-2";
    var __fadeSpeed = 10;
    var __fadeIncrement = 5;
    var __fadeMinOpacity = 0;
    var __fadeMaxOpacity = 100;
    var __origLocation = { X: null, Y: null };
    var __origSize = { Width: null, Height: null };
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __scrollDirection = null;
    var __scrollEventSection = null;
    var __scrollPrevSection = null;
    var __scrollPosition = { X: 0, Y: 0 };
    var __shaftActive = false;
    var __shaftIteration = null;
    var __shaftLocation = { X: null, Y: null };
    var __shaftOffset = 2;
    var __shaftDelayPress = 300;
    var __shaftSpeed = 50;
    var __shaftResetTime = 10;
    var __shaftTimer = null;
    var __visible = false;
    var __this = this;
    eval(__controlName + " = this;");
    
    var __vScrollBar =
    {
        Enabled: false,
        Disabled: true,
        Inserted: false,
        EnterState: false,
        LeaveState: true,
        ControlVisible: false,
        ControlEventInfo: null,
        ControlTimer: null,
        ControlHasScrolled: false,
        ControlSize: { Width: null, Height: null },
        ControlPadding: 0,
        Location: { X: null, Y: null },
        Name: "VScrollBar",
        Width: null,
        Height: null,
        ThumbEnabled: false,
        ThumbLocation: { X: null, Y: null },
        ThumbSize: { Width: null, Height: null },
        ThumbMinHeight: null,
        ThumbTopHeight: null,
        ThumbGripHeight: null,
        ThumbBottomHeight: null,
        ThumbEnterState: false,
        ThumbLeaveState: true
    }
    
    var __hScrollBar =
    {
        Enabled: false,
        Disabled: true,
        Inserted: false,
        EnterState: false,
        LeaveState: true,
        ControlVisible: false,
        ControlEventInfo: null,
        ControlTimer: null,
        ControlHasScrolled: false,
        ControlSize: { Width: null, Height: null },
        ControlPadding: 0,
        Width: null,
        Height: null,
        Location: { X: null, Y: null },
        Name: "HScrollBar",
        ThumbEnabled: false,
        ThumbLocation: { X: null, Y: null },
        ThumbSize: { Width: null, Height: null },
        ThumbMinHeight: null,
        ThumbTopHeight: null,
        ThumbGripHeight: null,
        ThumbBottomHeight: null,
        ThumbEnterState: false,
        ThumbLeaveState: true
    }
    
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
    this.BorderColor = null;
    this.BorderSize = 1;
    this.BorderStyle = null;
    this.Bottom = 0;
    this.ContainsFocus = false;
    this.Created = false;
    this.Cursor = null;
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.HorizontalScrollBar = true;
    this.Left = 0;
    this.Location = { X: null, Y: null };
    this.MouseWheel = 8;
    this.PageID = null;
    this.Parent = null;
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnGotFocus = null;
    this.OnLostFocus = null;
    this.OnMouseWheel = null;
    this.OnScroll = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.RightToLeftLayout = false;
    this.TabIndex = null;
    this.Tag = null;
    this.Text = null;
    this.Top = 0;
    this.VerticalScrollBar = true;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
    
    this.VScrollBar =
    {
        AlwaysVisible: false,
        Dock: null,
        Height: null,
        LargeChange: null,
        Maximum: null,
        Minimum: null,
        OnVisibleChanged: null,
        ShowArrows: true,
        ShowHoverEffect: true,
        ShowFadeEffect: true,
        ShowThumb: true,
        SmallChange: null,
        Visible: false,
        Width: null
    }
    
    this.HScrollBar =
    {
        AlwaysVisible: false,
        Dock: null,
        Height: null,
        LargeChange: null,
        Maximum: null,
        Minimum: null,
        OnVisibleChanged: null,
        ShowArrows: true,
        ShowHoverEffect: true,
        ShowFadeEffect: true,
        ShowThumb: true,
        SmallChange: null,
        Visible: false,
        Width: null
    }
    
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
            
            if (__this.Created && (b || x != xPos || y != yPos))
            {
                with (__pageNode.style)
                {
                    left = __System.Convert._IsNullToDefault(__this.Location.X, left);
                    top = __System.Convert._IsNullToDefault(__this.Location.Y, top);
                    
                    if (b)
                    {
                        width = __System.Convert._IsNullToDefault(__this.Width, width);
                        height = __System.Convert._IsNullToDefault(__this.Height, height);
                    }
                }
                
                __origLocation = __System.Controls.DOM.Location(__pageNode, true);
                
                ___InsertControl();
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
                __this.Width = __System.Convert.ToInt32(size0);
            }
            
            if (size1 != null)
            {
                __this.Height = __System.Convert.ToInt32(size1);
            }
            
            if (__this.Created && (w != __this.Width || h != __this.Height))
            {
                if (!_calculateSize)
                {
                    with (__pageNode.style)
                    {
                        width = __System.Convert._IsNullToDefault(__this.Width, width);
                        height = __System.Convert._IsNullToDefault(__this.Height, height);
                    }
                    
                    ___InsertControl();
                }
                else
                {
                    return true;
                }
            }
        }
    }
    
    function ___BeginDrag(/*Event*/ evt, /*Element*/ node, /*Object*/ o)
    {
        // summary:
        //   Initiates the drag feature for the scrollbar until
        //   a mouseup page event is fired.
        //
        // arguments:
        //   evt (required)
        //   node (required)
        //   o (required)
        //
        // returns: Nothing
        
        if (o._SystemVars != null)
        {
            __dragLocation = __System.Controls.DOM.ConvertPoint(evt);
            __dragLocation.X += o._SystemVars.ThumbLocation.X - parseInt(node.style.left);
            __dragLocation.Y += o._SystemVars.ThumbLocation.Y - parseInt(node.style.top);
            __dragDistance = 0;
            __dragActive = true;
        }
    }
    
    function ___BeginFade(/*String*/ section, /*String*/ control, /*Integer*/ state)
    {
        // summary:
        //   Tests for valid fade state changes and then updates
        //   the images based on the fade direction.
        //
        // arguments:
        //   section (required)
        //   control (required)
        //   state (required)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            var o1 = document.getElementById(control);
            
            if (o1 != null)
            {
                var n = parseInt(o1.imageState);
                
                if (n == state)
                {
                    return;
                }
                else if (!___IsValidState(o.sectionName, n, state))
                {
                    if (o1.dirControl != null)
                    {
                        ___SetImage({ type: null }, o.sectionName, o1.dirControl, state, true, true);
                    }
                    else
                    {
                        ___SetAllControls(o.sectionName, state, true, true);
                    }
                    
                    ___ResetFade(o.sectionName, control, state);
                    
                    return;
                }
                
                clearTimeout(o1.intervalTimer);
                
                o1.fadeDirection = (n < state ? 1 : -1);
                o1.imageState = state;
                
                if (o1.dirControl != null)
                {
                    ___SetImage({ type: null }, o.sectionName, o1.dirControl, (o1.fadeDirection == 1 ? n : state), true, true);
                    ___SetImage({ type: null }, o.sectionName, o1.dirControl, (o1.fadeDirection == 1 ? state : n), true, true, 1);
                }
                else
                {
                    ___SetAllControls(section, (o1.fadeDirection == 1 ? n : state), true, true);
                    ___SetAllControls(section, (o1.fadeDirection == 1 ? state : n), true, true, 1);
                }
                
                ___SetFadeOpacity(control, (o1.fadeDirection == 1 ? __fadeMinOpacity : __fadeMaxOpacity));
                __this._ProcessFade(o.sectionName, control, state);
            }
        }
    }
    
    function ___BeginShaft(/*Event*/ evt)
    {
        // summary:
        //   Captures a mousedown on the scrollbar shaft and
        //   moves it at least once.
        //
        // arguments:
        //   evt (required)
        //
        // returns: Nothing
        
        ___ResetShaft();
        
        __shaftLocation = __System.Controls.DOM.ConvertPoint(evt);
        __shaftIteration = 0;
        __shaftActive = true;
        
        __this._MoveShaft();
    }
    
    function ___ContentSize(/*String*/ section, /*Boolean*/ useContentSize)
    {
        // summary:
        //   Subtracts the scrollbar size with the related content region
        //   size to determine how much can be scrolled.
        //
        // arguments:
        //   section (required)
        //
        // returns: Integer
        
        var n1 = ___OffsetSize(section);
        var n2 = ___OffsetScrollSize((section == __vScrollBar.Name));
        
        return (useContentSize ? n1 : Math.max(n1, n2)) - n2;
    }
    
    function ___Current(/*String*/ section)
    {
        // summary:
        //  Provides the current context for the control or
        //  a specific context when sectionName is specified.
        //
        // arguments:
        //  section (optional)
        //
        // returns: Object
        
        var o =
        {
            _UserVars: null,
            _SystemVars: null,
            sectionName: null,
            isVertical: null
        }
        
        var b = section;
        
        if (typeof section == "string")
        {
            if (section == __vScrollBar.Name || section == __hScrollBar.Name)
            {
                b = (section == __vScrollBar.Name);
            }
            else
            {
                return null;
            }
        }
        
        if ((b != null && b == true) || (b == null && __vScrollBar.Enabled))
        {
            with (o)
            {
                _UserVars = __this.VScrollBar;
                _SystemVars = __vScrollBar;
                sectionName = __vScrollBar.Name;
                isVertical = true;
            }
        }
        else if ((b != null && b == false) || (b == null && __hScrollBar.Enabled))
        {
            with (o)
            {
                _UserVars = __this.HScrollBar;
                _SystemVars = __hScrollBar;
                sectionName = __hScrollBar.Name;
                isVertical = false;
            }
        }
        
        return o;
    }
    
    function ___EnableArrows(/*String*/ section, /*Boolean*/ useInsert)
    {
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            var b1 = o._SystemVars.ControlVisible;
            var b2 = o._SystemVars.ThumbEnabled;
            
            o._SystemVars.ControlVisible = o._UserVars.ShowArrows;
            o._SystemVars.ThumbEnabled = o._UserVars.ShowThumb;
            
            var y1 = (o.isVertical ? __System.Convert._IsNullToDefault(__this.VScrollBar.Height, __vScrollBar.Height) : __System.Convert._IsNullToDefault(__this.HScrollBar.Width, __hScrollBar.Width));
            
            if (y1 < ___MinControlSize(o.sectionName))
            {
                var y2 = (o._UserVars.ShowArrows ? ((o.isVertical ? o._SystemVars.ControlSize.Height : o._SystemVars.ControlSize.Width) * 2) + (o._SystemVars.ControlPadding * 4) : (o._UserVars.ShowThumb ? o._SystemVars.ThumbTopHeight + o._SystemVars.ThumbBottomHeight : 0));
                
                if (o._UserVars.ShowArrows)
                {
                    if (o._UserVars.ShowThumb)
                    {
                        if (y2 < y1)
                        {
                            o._SystemVars.ThumbEnabled = false;
                        }
                        else
                        {
                            o._SystemVars.ThumbEnabled = false;
                            o._SystemVars.ControlVisible = false;
                        }
                    }
                    else if (!o._UserVars.ShowThumb && y2 > y1)
                    {
                        o._SystemVars.ControlVisible = false;
                    }
                }
                else if (o._UserVars.ShowThumb && y1 < y2)
                {
                    o._SystemVars.ThumbEnabled = false;
                }
            }
            
            if (b1 != o._SystemVars.ControlVisible || b2 != o._SystemVars.ThumbEnabled)
            {
                if (useInsert)
                {
                    if (b1 == o._SystemVars.ControlVisible && b2 && b2 != o._SystemVars.ThumbEnabled)
                    {
                        __System.Controls.DOM.Remove(__controlName + "$Thumb$" + o.sectionName, __controlName + "$Shaft$0$" + o.sectionName);
                    }
                    else
                    {
                        ___Insert(o.sectionName);
                    }
                }
                else
                {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    function ___EndDrag(/*Event*/ evt)
    {
        // summary:
        //   Performs any queued control states which might
        //   have occured during the drag operation.
        //
        // arguments:
        //   evt (required)
        //
        // returns: Nothing
        
        __dragLocation.X = null;
        __dragLocation.Y = null;
        __dragDistance = 0;
        __dragActive = false;
        
        if (__scrollEventSection != null)
        {
            var o = ___Current(__scrollEventSection);
            
            if (o._SystemVars.ControlTimer == -1)
            {
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(__scrollEventSection, 1, 1, (o._SystemVars.ThumbEnterState ? 2 : 1));
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(__scrollEventSection, 1);
                }
            }
            
            __this._InvokeArrowUpEvent(__scrollEventSection);
        }
        
        var o = ___Current(__scrollPrevSection);
        
        if (o._SystemVars != null && o._SystemVars.ControlEventInfo != null)
        {
            var o1 = ___ParseStates(o._SystemVars.ControlEventInfo, 1);
            
            if (o1.length)
            {
                o._SystemVars.ControlEventInfo = null;
                
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(__scrollPrevSection, 1, 1, 1);
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(__scrollPrevSection, 1);
                }
                
                ___SetImage({ type: null }, __scrollPrevSection, o1[0], 2, true);
            }
            else if (o._SystemVars.LeaveState)
            {
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(__scrollPrevSection, 0, 0, 0);
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(__scrollPrevSection, 0);
                }
            }
            
            o1 = ___Current();
            
            if (o1.sectionName != __scrollPrevSection)
            {
                o._SystemVars.ControlEventInfo = null;
            }
        }
        
        var o = ___Current();
        
        if (o._SystemVars != null)
        {
            var p = __System.Controls.DOM.ConvertPoint(evt);
            
            if (o._SystemVars.LeaveState)
            {
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(o.sectionName, 0, 0, 0);
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(o.sectionName, 0, null, true);
                }
                
                o._SystemVars.ControlEventInfo = null;
                
                ___SwitchTo(null);
            }
            else if (o._SystemVars.ThumbEnterState)
            {
                ___SwitchTo(o.sectionName);
                
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(o.sectionName, 1, 1, 2);
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(o.sectionName, 1);
                    ___SetAllControls(o.sectionName, 2, true);
                }
            }
            else if (o._SystemVars.ThumbLeaveState)
            {
                if (o._UserVars.ShowFadeEffect)
                {
                    ___InitFade(o.sectionName, null, null, 1);
                }
                else if (o._UserVars.ShowHoverEffect)
                {
                    ___SetAllControls(o.sectionName, 1, true);
                }
                
                var s = ___IsWithinBoundsOf(o.sectionName, p);
                
                if (s != null)
                {
                    ___SetImage({ type: null }, o.sectionName, s, 2, true);
                }
                
                o._SystemVars.ThumbLeaveState = false;
            }
            
            var s = ___SwapSection(o.sectionName);
            
            if (s != null)
            {
                var o = ___Current(s);
                
                if (o._SystemVars != null)
                {
                    if (o._SystemVars.EnterState)
                    {
                        if (o._SystemVars.ThumbEnterState)
                        {
                            if (o._UserVars.ShowFadeEffect)
                            {
                                ___InitFade(o.sectionName, 1, 1, 2);
                            }
                            else if (o._UserVars.ShowHoverEffect)
                            {
                                ___SetAllControls(o.sectionName, 2, true);
                            }
                        }
                        else
                        {
                            if (o._UserVars.ShowFadeEffect)
                            {
                                ___InitFade(o.sectionName, 1, 1, 1);
                            }
                            else if (o._UserVars.ShowHoverEffect)
                            {
                                ___SetAllControls(o.sectionName, 1);
                            }
                            
                            s = ___IsWithinBoundsOf(o.sectionName, p);
                            
                            if (s != null)
                            {
                                ___SetImage({ type: null }, o.sectionName, s, 2, true);
                            }
                        }
                        
                        ___SwitchTo(o.sectionName);
                    }
                }
            }
        }
    }
    
    function ___EndFade(/*String*/ section, /*String*/ control, /*Integer*/ state)
    {
        // summary:
        //   Updates the control to display the fade state chosen
        //   during the initilization.
        //
        // arguments:
        //   section (required)
        //   control (required)
        //   state (required)
        //
        // returns: Nothing
        
        ___ResetFade(section, control);
        
        var o1 = document.getElementById(control);
        
        if (o1.dirControl != null)
        {
            ___SetImage({ type: null }, section, o1.dirControl, state, true, true);
        }
        else
        {
            ___SetAllControls(section, state, true, true);
        }
    }
    
    function ___EndShaft(/*Integer*/ resetTime)
    {
        // summary:
        //   Restores the shaft to its original state by making
        //   the highlight layer invisible.
        //
        // arguments:
        //   useResetTime (optional)
        //
        // returns: Nothing
        
        ___ResetShaft(resetTime);
        
        __shaftLocation = null;
        __shaftIteration = 0;
        __shaftActive = false;
    }
        
    function ___FindSection(/*String*/ section)
    {
        // summary:
        //   Determines the section which is currently being
        //   used in boolean format.
        //
        // arguments:
        //   section (optional)
        //
        // returns: Boolean
        
        var b = null;
        
        if (typeof section == "boolean")
        {
            b = section;
        }
        else if (section != null)
        {
            if (__vScrollBar.Name == section)
            {
                b = true;
            }
            else if (__hScrollBar.Name == section)
            {
                b = false;
            }
        }
        else
        {
            if (__vScrollBar.Enabled)
            {
                b = true;
            }
            else if (__hScrollBar.Enabled)
            {
                b = false;
            }
        }
        
        return b;
    }
    
    function ___InitFade(/*String*/ section, /*Integer*/ upState, /*Integer*/ downState, /*Integer*/ thumbState)
    {
        // summary:
        //   Lets you synchronize the fade states for the entire
        //   scrollbar control.
        //
        // arguments:
        //   section (required)
        //   upState (optional)
        //   downState (optional)
        //   thumbState (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars.ControlVisible)
        {
            if (upState != null)
            {
                ___SetImage({ type: null }, o.sectionName, "Up", upState, true);
            }
            
            if (downState != null)
            {
                ___SetImage({ type: null }, o.sectionName, "Down", downState, true);
            }
        }
        
        if (o._SystemVars.ThumbEnabled && thumbState != null)
        {
            ___BeginFade(o.sectionName, __controlName + "$Thumb$1$" + o.sectionName, thumbState);
        }
    }
    
    function ___Insert(/*String*/ section)
    {
        // summary:
        //   Places a scrollbar onto the page based on previously
        //   defined configuration values.  
        //
        // arguments:
        //   section (required)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            o._SystemVars.Inserted = false;
            
            if (((o.isVertical && __this.VerticalScrollBar) || (!o.isVertical && __this.HorizontalScrollBar)) && (!o._SystemVars.Disabled || o._UserVars.AlwaysVisible))
            {
                o._SystemVars.Inserted = true;
                
                var o1 = __System.Controls.DOM.Append({
                                                        ID: __controlName + "$Shaft$0$" + o.sectionName,
                                                        X: o._SystemVars.Location.X,
                                                        Y: o._SystemVars.Location.Y,
                                                        Width: __System.Convert._IsNullToDefault(o._UserVars.Width, o._SystemVars.Width),
                                                        Height: __System.Convert._IsNullToDefault(o._UserVars.Height, o._SystemVars.Height),
                                                        FontSize: 0,
                                                        Background: "url(" + __resources[o.sectionName + "Shaft"].Build(1, ___IsDockReversed(o.sectionName)) + ") repeat-" + (o.isVertical ? "y" : "x"),
                                                        Cursor: __this.Cursor,
                                                        Visibility: true,
                                                        RightToLeft: false,
                                                        Parent: __pageNode
                                                      });
                
                ___EnableArrows(o.sectionName);
                
                with (o1)
                {
                    var w = (o._SystemVars.ControlSize.Width + (o._SystemVars.ControlPadding * 2));
                    var h = (o._SystemVars.ControlSize.Height + (o._SystemVars.ControlPadding * 2));
                    
                    var s = "";
                    
                    if (o._SystemVars.ControlVisible)
                    {
                        s += '<div unselectable="on" style="position:absolute;top:0px;left:0px;width:' + w + 'px;height:' + h + 'px">' +
                             '<div id="' + __controlName + '$Control$Up$' + o.sectionName + '" unselectable="on" style="position:absolute;top:0px;left:0px;padding:' + o._SystemVars.ControlPadding + 'px;z-index:1"><img id="' + __controlName + '$Control$Up$' + (o._UserVars.ShowFadeEffect ? 1 : 0) + '$' + o.sectionName + '" src="' + __resources[o.sectionName + (o.isVertical ? "Up" : "Left")].Build(0) + '" unselectable="on" sectionName="' + o.sectionName + '" dirControl="Up" ' + (o._UserVars.ShowFadeEffect ? "imageState=\"" + 0 + "\" curOpacity=\"" + __fadeMinOpacity + "\" " : "") + ' style="width:' + o._SystemVars.ControlSize.Width + 'px;height:' + o._SystemVars.ControlSize.Height + (o._UserVars.ShowFadeEffect ? ";filter:alpha(opacity=" + __fadeMinOpacity + ")" : "") + '" /></div>';
                        
                        if (o._UserVars.ShowFadeEffect)
                        {
                            s += '<div unselectable="on" style="position:absolute;top:0px;left:0px;padding:' + o._SystemVars.ControlPadding + 'px"><img id="' + __controlName + '$Control$Up$0$' + o.sectionName + '" src="' + __resources[o.sectionName + (o.isVertical ? "Up" : "Left")].Build(0) + '" unselectable="on" style="width:' + o._SystemVars.ControlSize.Width + 'px;height:' + o._SystemVars.ControlSize.Height +'" /></div>';
                        }
                        
                        s += '</div>';
                    }
                    
                    s += '<div id="' + __controlName + '$Control$Shaft$' + o.sectionName + '" unselectable="on" style="position:absolute;top:' + (o.isVertical && o._SystemVars.ControlVisible ? h : 0) + 'px;left:' + (o.isVertical ? 0 : (o._SystemVars.ControlVisible ? w : 0)) + 'px;' + (o.isVertical ? "height" : "width") + ':' + ___OffsetScrollBar(o.sectionName) + 'px;' + (o.isVertical ? "width" : "height") + ':' + ___ScrollBarFixedSize(o.isVertical) + 'px"></div>';
                    
                    if (o._SystemVars.ControlVisible)
                    {
                        s += '<div id="' + __controlName + '$Control$Down$Position$' + o.sectionName + '" unselectable="on" style="position:absolute;top:' + (o.isVertical ? __System.Convert._IsNullToDefault(o._UserVars.Height, o._SystemVars.Height) - h : 0) + 'px;left:' + (o.isVertical ? 0 : __System.Convert._IsNullToDefault(o._UserVars.Width, o._SystemVars.Width) - w) + 'px;width:' + w + 'px;height:' + h + 'px">' +
                             '<div id="' + __controlName + '$Control$Down$' + o.sectionName + '" unselectable="on" style="position:absolute;top:0px;left:0px;padding:' + o._SystemVars.ControlPadding + 'px;z-index:1"><img id="' + __controlName + '$Control$Down$' + (o._UserVars.ShowFadeEffect ? 1 : 0) + '$' + o.sectionName + '" src="' + __resources[o.sectionName + (o.isVertical ? "Down" : "Right")].Build(0) + '" unselectable="on" sectionName="' + o.sectionName + '" dirControl="Down" ' + (o._UserVars.ShowFadeEffect ? "imageState=\"" + 0 + "\" curOpacity=\"" + __fadeMinOpacity + "\" " : "") + ' style="width:' + o._SystemVars.ControlSize.Width + 'px;height:' + o._SystemVars.ControlSize.Height + (o._UserVars.ShowFadeEffect ? ";filter:alpha(opacity=" + __fadeMinOpacity + ")" : "") + '" /></div>';
                        
                        if (o._UserVars.ShowFadeEffect)
                        {
                            s += '<div unselectable="on" style="position:absolute;top:0px;left:0px;padding:' + o._SystemVars.ControlPadding + 'px"><img id="' + __controlName + '$Control$Down$0$' + o.sectionName + '" src="' + __resources[o.sectionName + (o.isVertical ? "Down" : "Right")].Build(0) + '" unselectable="on" style="width:' + o._SystemVars.ControlSize.Width + 'px;height:' + o._SystemVars.ControlSize.Height +'" /></div>';
                        }
                        
                        s += '</div>';
                    }
                    
                    innerHTML = s;
                    
                    if (o._SystemVars.ControlVisible)
                    {
                        with (document.getElementById(__controlName + "$Control$Up$" + o.sectionName))
                        {
                            onmouseup = function()
                            {
                                if (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                                {
                                    ___InvokeArrowCancelEvent(event, o.sectionName, null, "Up");
                                }
                            }
                        }
                        
                        with (document.getElementById(__controlName + "$Control$Down$" + o.sectionName))
                        {
                            onmouseup = function()
                            {
                                if (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                                {
                                    ___InvokeArrowCancelEvent(event, o.sectionName, null, "Down");
                                }
                            }
                        }
                        
                        ___SetControlEventHandler(__controlName + "$Control$Up$" + (o._UserVars.ShowFadeEffect ? 1 : 0) + "$" + o.sectionName);
                        ___SetControlEventHandler(__controlName + "$Control$Down$" + (o._UserVars.ShowFadeEffect ? 1 : 0) + "$" + o.sectionName);
                    }
                    
                    if (!o._SystemVars.Disabled)
                    {
                        onmouseenter = function()
                        {
                            o._SystemVars.EnterState = true;
                            o._SystemVars.LeaveState = false;
                            
                            if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                            {
                                if (__scrollEventSection == null)
                                {
                                    if (!__dragActive && !__shaftActive)
                                    {
                                        ___SwitchTo(o.sectionName);
                                        
                                        if (o._UserVars.ShowFadeEffect)
                                        {
                                            ___InitFade(o.sectionName, 1, 1, 1);
                                        }
                                        else if (o._UserVars.ShowHoverEffect)
                                        {
                                            ___SetAllControls(o.sectionName, 1);
                                        }
                                    }
                                }
                            }
                        }
                        
                        onmouseleave = function()
                        {
                            if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                            {
                                if (__shaftActive)
                                {
                                    ___ResetShaft();
                                }
                                
                                if (__scrollEventSection == null)
                                {
                                    if (!__dragActive && !__shaftActive)
                                    {
                                        var b = (o._SystemVars.ControlEventInfo == null);
                                        
                                        if (!b)
                                        {
                                            var o1 = ___ParseStates(o._SystemVars.ControlEventInfo);
                                            b = (o1[3] != "mousedown");
                                        }
                                        
                                        if (b)
                                        {
                                            if (o._UserVars.ShowFadeEffect)
                                            {
                                                ___InitFade(o.sectionName, 0, 0, 0);
                                            }
                                            else if (o._UserVars.ShowHoverEffect)
                                            {
                                                ___SetAllControls(o.sectionName, 0);
                                            }
                                        }
                                        
                                        ___SwitchTo(null);
                                    }
                                }
                            }
                            
                            o._SystemVars.EnterState = false;
                            o._SystemVars.LeaveState = true;
                        }
                        
                        with (document.getElementById(__controlName + "$Control$Shaft$" + o.sectionName))
                        {
                            onmouseenter = function()
                            {
                                if (__shaftActive && __shaftTimer == null && o.sectionName == ___Current().sectionName)
                                {
                                    __this._MoveShaft();
                                }
                            }
                            
                            onmousedown = function()
                            {
                                o._SystemVars.EnterState = true;
                                o._SystemVars.LeaveState = false;
                                
                                if (!__dragActive && !__shaftActive && ___TryEventMouseClick(__this) && ___TryEventFocus(true))
                                {
                                    ___SwitchTo(o.sectionName);
                                    
                                    if (o._UserVars.ShowFadeEffect)
                                    {
                                        ___InitFade(o.sectionName, 1, 1, 1);
                                    }
                                    else if (o._UserVars.ShowHoverEffect)
                                    {
                                        ___SetAllControls(o.sectionName, 1, null, true);
                                    }
                                    
                                    if (o._SystemVars.ThumbEnabled)
                                    {
                                        var p = __System.Controls.DOM.Location(__controlName + "$Thumb$" + o.sectionName, true);
                                        
                                        if (o.isVertical)
                                        {
                                            p.Y += __shaftOffset;
                                            __scrollDirection = (event.clientY > p.Y ? 1 : -1);
                                        }
                                        else
                                        {
                                            p.X += __shaftOffset;
                                            __scrollDirection = (event.clientX > p.X ? 1 : -1);
                                        }
                                    }
                                    else
                                    {
                                        if (o.isVertical)
                                        {
                                            __scrollDirection = (event.clientY > __origLocation.Y + o._SystemVars.Location.Y + Math.floor(__System.Convert._IsNullToDefault(__this.VScrollBar.Height, __vScrollBar.Height) / 2) ? 1 : -1);
                                        }
                                        else
                                        {
                                            __scrollDirection = (event.clientX > __origLocation.X + o._SystemVars.Location.X + Math.floor(__System.Convert._IsNullToDefault(__this.HScrollBar.Width, __vScrollBar.Width) / 2) ? 1 : -1);
                                        }
                                    }
                                    
                                    ___BeginShaft(event);
                                }
                            }
                        }
                        
                        __System.Controls.DOM.Append({
                                                       ID: __controlName + "$Shaft$1$" + o.sectionName,
                                                       X: 0,
                                                       Y: 0,
                                                       Width: __System.Convert._IsNullToDefault(o._UserVars.Width, o._SystemVars.Width),
                                                       Height: __System.Convert._IsNullToDefault(o._UserVars.Height, o._SystemVars.Height),
                                                       FontSize: 0,
                                                       Visibility: false,
                                                       ZIndex: 1,
                                                       Cursor: __this.Cursor,
                                                       Background: "url(" + __resources[o.sectionName + "Shaft"].Build(3) + ") repeat-" + (o.isVertical ? "y" : "x"),
                                                       Parent: o1
                                                     });
                        
                        ___InsertThumb(o.sectionName);
                    }
                    else
                    {
                        o._SystemVars.ThumbEnabled = false;
                    }
                }
            }
            else
            {
                __System.Controls.DOM.Remove(__controlName + "$Shaft$0$" + o.sectionName);
            }
        }
    }
    
    function ___InsertControl(/*Boolean*/ useInsert)
    {
        // summary:
        //   Calculates the dimensions of the scroll region
        //   and then adds the scrollbars.
        //
        // arguments:
        //   useInsert (optional)
        //
        // returns: Nothing
        
        ___PositionControl(useInsert);
    }
    
    function ___InsertThumb(/*String*/ section)
    {
        // summary:
        //   Figures out the correct thumb size in relation to
        //   the amount of the scroll region and then places it 
        //   in the scrollbar shaft.   
        //
        // arguments:
        //   section (required)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null && o._SystemVars.ThumbEnabled)
        {
            var thumbSize = ___ThumbFixedSize(o.isVertical);
            
            o._SystemVars.ThumbMinHeight = o._SystemVars.ThumbTopHeight + o._SystemVars.ThumbBottomHeight;
            o._SystemVars.ThumbLocation.X = (o.isVertical ? Math.floor((___ScrollBarFixedSize(o.isVertical) - o._SystemVars.ThumbSize.Width) / 2) : 0) + (!o.isVertical && o._SystemVars.ControlVisible ? o._SystemVars.ControlSize.Width + (o._SystemVars.ControlPadding * 2) : 0);
            o._SystemVars.ThumbLocation.Y = (o.isVertical ? 0 : Math.floor((___ScrollBarFixedSize(o.isVertical) - o._SystemVars.ThumbSize.Height) / 2)) + (o.isVertical && o._SystemVars.ControlVisible ? o._SystemVars.ControlSize.Height + (o._SystemVars.ControlPadding * 2) : 0);
            
            var s = '<div id="' + __controlName + '$Thumb$0$' + o.sectionName + '" unselectable="on" style="position:absolute">' +
                    '<table dir="ltr" id="' + __controlName + '$Thumb$0$Content$' + o.sectionName + '" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="' + (o.isVertical ? "width:" + o._SystemVars.ThumbSize.Width : "height:" + o._SystemVars.ThumbSize.Height) + 'px">' +
                    '<tr>' +
                    '<td id="' + __controlName + '$Thumb$0$Top$' + o.sectionName + '" unselectable="on" style="' + (o.isVertical ? "height" : "width") + ':' + o._SystemVars.ThumbTopHeight + 'px;background-image:url(' + __resources[o.sectionName + "Thumb" + (o.isVertical ? "Top" : "Left")].Build(0) + ')"></td>' +
                    (o.isVertical ? '</tr><tr id="' + __controlName + '$Thumb$0$Row$1$' + o.sectionName + '">' : '') +
                    '<td id="' + __controlName + '$Thumb$0$Background$' + o.sectionName + '" unselectable="on" style="text-align:center;background-image:url(' + __resources[o.sectionName + "ThumbBg"].Build(0) + ');background-repeat:repeat-' + (o.isVertical ? "y" : "x") + '"></td>' +
                    (o.isVertical ? '</tr><tr>' : '') +
                    '<td id="' + __controlName + '$Thumb$0$Bottom$' + o.sectionName + '" unselectable="on" style="' + (o.isVertical ? "height" : "width") + ':' + o._SystemVars.ThumbBottomHeight + 'px;background-image:url(' + __resources[o.sectionName + "Thumb" + (o.isVertical ? "Bottom" : "Right")].Build(0) + ')"></td>' +
                    '</tr>' +
                    '</table>' +
                    '<table dir="ltr" id="' + __controlName + "$Thumb$0$Grip$" + o.sectionName + '" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;' + (o.isVertical ? "left" : "top") + ':0px;' + (o.isVertical ? "width:" + o._SystemVars.ThumbSize.Width : "height:" + o._SystemVars.ThumbSize.Height) + 'px;z-index:1">' +
                    '<tr>' +
                    '<td style="text-align:center"><img id="' + __controlName + '$Thumb$0$Grip$Image$' + o.sectionName + '" src="' + __resources[o.sectionName + "ThumbGrip"].Build(0) + '" unselectable="on" /></td>' +
                    '</tr>' +
                    '</table>' +
                    '</div>';
            
            if (o._UserVars.ShowFadeEffect)
            {
                s += '<div id="' + __controlName + '$Thumb$1$' + o.sectionName + '" unselectable="on" imageState="' + 0 + '" curOpacity="' + __fadeMinOpacity + '" style="position:absolute;filter:alpha(opacity=' + __fadeMinOpacity + ');z-index:1">' +
                     '<table dir="ltr" id="' + __controlName + '$Thumb$1$Content$' + o.sectionName + '" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="' + (o.isVertical ? "width:" + o._SystemVars.ThumbSize.Width : "height:" + o._SystemVars.ThumbSize.Height) + 'px">' +
                     '<tr>' +
                     '<td id="' + __controlName + '$Thumb$1$Top$' + o.sectionName + '" unselectable="on" style="' + (o.isVertical ? "height" : "width") + ':' + o._SystemVars.ThumbTopHeight + 'px"></td>' +
                     (o.isVertical ? '</tr><tr id="' + __controlName + '$Thumb$1$Row$1$' + o.sectionName + '">' : '') +
                     '<td id="' + __controlName + '$Thumb$1$Background$' + o.sectionName + '" unselectable="on" style="text-align:center;background-repeat:repeat-' + (o.isVertical ? "y" : "x") + '"></td>' +
                     (o.isVertical ? '</tr><tr>' : '') +
                     '<td id="' + __controlName + '$Thumb$1$Bottom$' + o.sectionName + '" unselectable="on" style="' + (o.isVertical ? "height" : "width") + ':' + o._SystemVars.ThumbBottomHeight + 'px"></td>' +
                     '</tr>' +
                     '</table>' +
                     '<table dir="ltr" id="' + __controlName + '$Thumb$1$Grip$' + o.sectionName + '" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;' + (o.isVertical ? "left" : "top") + ':0px;' + (o.isVertical ? "width:" + o._SystemVars.ThumbSize.Width : "height:" + o._SystemVars.ThumbSize.Height) + 'px;z-index:1">' +
                     '<tr>' +
                     '<td style="text-align:center"><img id="' + __controlName + '$Thumb$1$Grip$Image$' + o.sectionName + '" src="' + __resources[o.sectionName + "ThumbGrip"].Build(0) + '" unselectable="on" /></td>' +
                     '</tr>' +
                     '</table>' +
                     '</div>';
            }
            
            var o1 = __System.Controls.DOM.Append({
                                                    ID: __controlName + "$Thumb$" + o.sectionName,
                                                    Width: (o.isVertical ? ___ScrollBarFixedSize(o.isVertical) : null),
                                                    Height: (o.isVertical ? null : ___ScrollBarFixedSize(o.isVertical)),
                                                    ZIndex: 2,
                                                    Cursor: __this.Cursor,
                                                    Html: s,
                                                    Parent: __controlName + "$Shaft$0$" + o.sectionName
                                                  });
            
            ___ResizeThumb(o.sectionName);
            
            with (o1)
            {
                onmouseenter = function()
                {
                    if (__scrollEventSection == null)
                    {
                        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                        {
                            if (!__dragActive && !__shaftActive)
                            {
                                if (o._UserVars.ShowFadeEffect)
                                {
                                    ___InitFade(o.sectionName, 1, 1, 2);
                                }
                                else if (o._UserVars.ShowHoverEffect)
                                {
                                    ___SetAllControls(o.sectionName, 2, true);
                                }
                            }
                        }
                        
                        o._SystemVars.ThumbLeaveState = false;
                    }
                    
                    o._SystemVars.ThumbEnterState = true;
                }
                
                onmouseleave = function()
                {
                    if (__scrollEventSection == null)
                    {
                        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                        {
                            if (!__dragActive && !__shaftActive)
                            {
                                if (o._UserVars.ShowFadeEffect)
                                {
                                    ___InitFade(o.sectionName, 1, 1, 1);
                                }
                                else if (o._UserVars.ShowHoverEffect)
                                {
                                    ___SetAllControls(o.sectionName, (o._SystemVars.Enabled ? 1 : null), true);
                                }
                            }
                        }
                        
                        o._SystemVars.ThumbLeaveState = true;
                    }
                    
                    o._SystemVars.ThumbEnterState = false;
                }
                
                onmousedown = function()
                {
                    if (!__dragActive && !__shaftActive && ___TryEventMouseClick(__this) && ___TryEventFocus(true))
                    {
                        ___SwitchTo(o.sectionName);
                        
                        if (__shaftActive)
                        {
                            ___EndShaft();
                        }
                        
                        ___BeginDrag(event, this, o);
                    }
                }
                
                onmouseup = function()
                {
                    if (o._UserVars.ShowFadeEffect)
                    {
                        ___InitFade(o.sectionName, 1, 1, 2);
                    }
                    else if (o._UserVars.ShowHoverEffect)
                    {
                        ___SetAllControls(o.sectionName, 2, true, true);
                    }
                }
            }
        }
    }
    
    function ___InvokeArrowCancelEvent(/*Event*/ evt, /*String*/ section, /*Boolean*/ isControl, /*String*/ button)
    {
        // summary:
        //   Tests to see where a mouseup has occurred within a
        //   scrollbar to ensure that each control is interpreted
        //   correctly.
        //
        // description:
        //   Some controls which specify padding do not receive
        //   mouseup events when the event occurs inside the
        //   padding or when a mousedown has been dragged outside
        //   the control. Therefore some mouseup events are handled
        //   by the page event mouseup instead of the control.
        //
        // arguments:
        //   evt (required)
        //   section (required)
        //   isControl (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null && !o._SystemVars.Disabled)
        {
            if (button != null)
            {
                ___SetImage({ type: null }, o.sectionName, button, (!o._SystemVars.LeaveState || o._SystemVars.EnterState ? 1 : 0), true);
            }
            
            var s = ___SwapSection(section);
            
            if (s != null)
            {
                var o1 = ___Current(s);
                
                if (o1._SystemVars.LeaveState && o1._SystemVars.ControlEventInfo != null)
                {
                    if (o1._UserVars.ShowFadeEffect)
                    {
                        ___InitFade(s, 0, 0, 0);
                    }
                    else if (o1._UserVars.ShowHoverEffect)
                    {
                        ___SetAllControls(s, 0, false, true);
                    }
                    
                    o1._SystemVars.ControlEventInfo = (!isControl || o1._SystemVars.ControlEventInfo == "" ? null : "");
                    
                    return;
                }
            }
            
            if (isControl && o._SystemVars.ControlEventInfo != null && ___ParseStates(o._SystemVars.ControlEventInfo, 1).length > 0)
            {
                var idx = o._SystemVars.ControlEventInfo.split(";");
                ___SetImage({ type: null }, section, idx[0].split(",")[1], 1, true);
                ___SetImage({ type: null }, section, idx[1].split(",")[0], 2, true);
                
                o._SystemVars.ControlEventInfo = null;
            }
            
            if (!__dragActive && !__shaftActive && (o._SystemVars.ControlEventInfo == null || !isControl))
            {
                ___RemoveEventMouseClick(__this);
                __System.Controls.DOM.CancelEvent(evt);
            }
        }
    }
    
    function ___InvokeArrowDownEvent(/*String*/ section, /*Integer*/ direction, /*Event*/ evt)
    {
        // summary:
        //   Initializes the scrolling for the scrollbar when a user
        //   has clicked on one of the control images.
        //
        // arguments:
        //   evt (required)
        //   section (required)
        //   direction (required)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null && !o._SystemVars.Disabled)
        {
            if (__shaftActive)
            {
                ___EndShaft();
            }
            
            __scrollEventSection = o.sectionName;
            __scrollDirection = direction;
            
            var idx = ___ParseStates(o._SystemVars.ControlEventInfo);
            
            if (idx.length == 3)
            {
                o._SystemVars.ControlEventInfo = section + "," + idx[1] + ",3," + (evt != null ? evt.type : "mousedown");
            }
            
            o._SystemVars.ControlHasScrolled = false;
            o._SystemVars.ControlTimer = setTimeout(__controlName + "._InvokeArrowUpEvent('" + o.sectionName + "', true)", __arrowsSpeed);
        }
    }
    
    function ___IsDockReversed(/*String*/ section)
    {
        // summary:
        //   Figures out when a section is not on the default
        //   side from the LTR perspective.
        //
        // arguments:
        //   section (required)
        //
        // returns: Boolean
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            if (o.isVertical)
            {
                return (o._UserVars.Dock != null ? (o._UserVars.Dock == __System.Controls.UI.Components.DockStyle.Left) : ___IsRightToLeft());
            }
            else
            {
                return (o._UserVars.Dock != null ? (o._UserVars.Dock == __System.Controls.UI.Components.DockStyle.Top) : false);
            }
        }
        
        return false;
    }
    
    function ___IsRightToLeft()
    {
        return (__this.RightToLeft || __this.RightToLeftLayout);
    }   
    
    function ___IsValidState(/*String*/ section, /*Integer*/ begin, /*Integer*/ end)
    {
        // summary:
        //   Tests a comma delimited string for numbered values
        //   which specify fade states which should be skipped.
        //
        // arguments:
        //   section (required)
        //   begin (required)
        //   end (required)
        //
        // returns: Boolean
        
        var o = ___Current(section);
        
        if (__fadeBypassPhase == null)
        {
            return true;
        }
        else if (typeof __fadeBypassPhase == "boolean")
        {
            return !o._UserVars.FadeBypassPhase;
        }
        
        var o1 = __fadeBypassPhase.split(",");
        
        for (var i = 0; i < o1.length; i++)
        {
            var idx = o1[i].split("-");
            
            if (idx.length == 2 && begin == idx[0] && end == idx[1])
            {
                return false;
            }
        }
        
        return true;
    }
    
    function ___IsWithinBoundsOf(/*String*/ section, /*Object*/ point)
    {
        // summary:
        //   Tests to see if a page event has occurred within
        //   a control in the scrollbar.
        //
        // arguments:
        //   section (required)
        //   point (required)
        //
        // returns: String
        
        var o1 = ["Up", "Down"];
        
        for (var i = 0; i < o1.length; i++)
        {
            if (__System.Controls.DOM.IsElementWithin(__controlName + "$Control$" + o1[i] + "$0$" + section, point))
            {
                return o1[i];
            }
        }
        
        return null;
    }
    
    function ___MinControlSize(/*String*/ section)
    {
        // summary:
        //   Calculates the minimum size for the scrollbar with
        //   the user enabled features.
        //
        // arguments:
        //   section (required)
        //
        // returns: Boolean
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            return (o._UserVars.ShowArrows ? ((o.isVertical ? o._SystemVars.ControlSize.Height : o._SystemVars.ControlSize.Width) * 2) + (o._SystemVars.ControlPadding * 4) : 0) + (o._UserVars.ShowThumb ? o._SystemVars.ThumbTopHeight + o._SystemVars.ThumbBottomHeight : 0);
        }
        
        return -1;
    }
    
    function ___MoveThumb(/*Integer*/ yOffset, /*String*/ section, /*Boolean*/ calculateResult)
    {
        // summary:
        //   Sets the thumb to the offset value in relation to
        //   the origin and returns the scroll amount for the
        //   content region.
        //
        // arguments:
        //   yOffset (required)
        //   section (optional)
        //   calculateResult (optional)
        //
        // returns: Integer
        
        var y0 = null;
        
        if (!isNaN(parseInt(yOffset)))
        {
            var o = ___Current((section != null ? section : null));
            
            if (o._SystemVars != null && o._SystemVars.ThumbEnabled)
            {
                with (document.getElementById(__controlName + "$Thumb$" + o.sectionName).style)
                {
                    var y1 = ___ScrollSize(o.sectionName);
                    var y2 = (o.isVertical ? o._SystemVars.ThumbLocation.Y : o._SystemVars.ThumbLocation.X) + Math.min(yOffset, y1);
                    
                    if (!isNaN(y2))
                    {
                        if (!calculateResult)
                        {
                            if (o.isVertical)
                            {
                                top = y2;
                            }
                            else
                            {
                                left = y2;
                            }
                        }
                        
                        if (___ThumbSize(o.isVertical) == o._SystemVars.ThumbMinHeight)
                        {
                            y0 = (yOffset < y1 ? Math.floor(((y2 - (o.isVertical ? o._SystemVars.ThumbLocation.Y : o._SystemVars.ThumbLocation.X)) / y1) * ___ContentSize(o.sectionName)) : ___ContentSize(o.sectionName));
                        }
                        else
                        {
                            y0 = parseInt(o.isVertical ? top : left) - (o.isVertical ? o._SystemVars.ThumbLocation.Y : o._SystemVars.ThumbLocation.X);
                        }
                        
                        y0 += __System.Convert._IsNullToDefault((o.isVertical ? __this.VScrollBar.Minimum : __this.HScrollBar.Minimum), 0);
                    }
                }
            }
        }
        
        return (isNaN(y0) ? null : y0);
    }
    
    function ___MoveThumbByScrollPosition(/*Integer*/ yOffset, /*String*/ section, /*Boolean*/ calculateResult)
    {
        // summary:
        //   Takes a scroll position value and sets the thumb to
        //   the equivalent scrollbar location.
        //
        // arguments:
        //   yOffset (required)
        //   section (optional)
        //   calculateResult (optional)
        //
        // returns: Integer
        
        var y0 = null;
        
        if (!isNaN(parseInt(yOffset)))
        {
            var b = ___FindSection(section);
            
            if (b != null)
            {
                var o = ___Current(b);
                
                if (o._SystemVars != null && !o._SystemVars.Disabled && o._SystemVars.ThumbEnabled)
                {
                    yOffset -= __System.Convert._IsNullToDefault((o.isVertical ? __this.VScrollBar.Minimum : __this.HScrollBar.Minimum), 0);
                    
                    with (document.getElementById(__controlName + "$Thumb$" + o.sectionName).style)
                    {
                        var y0 = (o.isVertical ? o._SystemVars.ThumbLocation.Y : o._SystemVars.ThumbLocation.X) + Math.min((___ThumbSize(o.isVertical) == o._SystemVars.ThumbMinHeight ? Math.round(yOffset * (___ScrollSize(o.sectionName) / ___ContentSize(o.sectionName))) : yOffset), ___ScrollSize(o.sectionName));
                        
                        if (!isNaN(y0))
                        {
                            if (!calculateResult)
                            {
                                if (o.isVertical)
                                {
                                    top = y0;
                                }
                                else
                                {
                                    left = y0;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return (isNaN(y0) ? null : y0);
    }
    
    function ___OffsetSize(/*String*/ section)
    {
        // summary:
        //   Uses the DOM to figure out the maximum content size
        //   for the specified scrollbar section.
        //
        // arguments:
        //   section (required)
        //
        // returns: Integer
        
        return (section == __vScrollBar.Name ? __this._OffsetHeight() : (section == __hScrollBar.Name ? __this._OffsetWidth() : 0));
    }
    
    function ___OffsetScrollBar(/*String*/ section, /*Boolean*/ withoutControls)
    {
        // summary:
        //   Calculates the size of the scrollbar with or without
        //   the controls.
        //
        // arguments:
        //   section (required)
        //   withoutControls (optional)
        //
        // returns: Integer
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            if (o.isVertical)
            {
                return __System.Convert._IsNullToDefault(__this.VScrollBar.Height, __vScrollBar.Height) - (o._SystemVars.ControlVisible && !withoutControls ? (o._SystemVars.ControlSize.Height * 2) + (o._SystemVars.ControlPadding * 4) : 0);
            }
            else
            {
                return __System.Convert._IsNullToDefault(__this.HScrollBar.Width, __hScrollBar.Width) - (o._SystemVars.ControlVisible && !withoutControls ? (o._SystemVars.ControlSize.Width * 2) + (o._SystemVars.ControlPadding * 4) : 0);
            }
        }
        else
        {
            return 0;
        }
    }
    
    function ___OffsetScrollSize(/*Boolean*/ isVertical)
    {
        return (isVertical ? __vScrollBar.Height : __hScrollBar.Width);
    }
    
    function ___OffsetShaft(/*String*/ section, /*Boolean*/ bypassInsert)
    {
        var o = ___Current(section);
        
        return (o._SystemVars != null && ((o.isVertical && __this.VerticalScrollBar) || (!o.isVertical && __this.HorizontalScrollBar)) && (o._SystemVars.Inserted || bypassInsert) ? ___ScrollBarFixedSize(o.isVertical) : 0);
    }
    
    function ___ParseResourceXmlCallback(/*Boolean*/ useLoad)
    {
        if (__resource.Xml != null)
        {
            __resources = ___ParseResourceXml(__resource, __this);
            
            if (__this.VerticalScrollBar)
            {
                __vScrollBar.Width = __resources["VScrollBarShaft"].Width;
                __vScrollBar.ControlSize = { Width: __resources["VScrollBarUp"].Width, Height: __resources["VScrollBarUp"].Height };
                __vScrollBar.ControlPadding = Math.floor((__System.Convert._IsNullToDefault(__this.VScrollBar.Width, __vScrollBar.Width) - __vScrollBar.ControlSize.Width) / 2);
                __vScrollBar.ThumbSize.Width = __resources["VScrollBarThumbBg"].Width;
                __vScrollBar.ThumbTopHeight = __resources["VScrollBarThumbTop"].Height;
                __vScrollBar.ThumbGripHeight = __resources["VScrollBarThumbGrip"].Height;
                __vScrollBar.ThumbBottomHeight = __resources["VScrollBarThumbBottom"].Height;
            }
            
            if (__this.HorizontalScrollBar)
            {
                __hScrollBar.Height = __resources["HScrollBarShaft"].Height;
                __hScrollBar.ControlSize = { Width: __resources["HScrollBarLeft"].Width, Height: __resources["HScrollBarLeft"].Height };
                __hScrollBar.ControlPadding = Math.floor((__System.Convert._IsNullToDefault(__this.HScrollBar.Height, __hScrollBar.Height) - __hScrollBar.ControlSize.Height) / 2);
                __hScrollBar.ThumbSize.Height = __resources["HScrollBarThumbBg"].Height;
                __hScrollBar.ThumbTopHeight = __resources["HScrollBarThumbLeft"].Width;
                __hScrollBar.ThumbGripHeight = __resources["HScrollBarThumbGrip"].Width;
                __hScrollBar.ThumbBottomHeight = __resources["HScrollBarThumbRight"].Width;
            }
            
            __resource.Xml = null;
            __resource.Parsing = false;
            
            if (useLoad)
            {
                __this.Load();
            }
        }
    }
    
    function ___ParseStates(/*String*/ controlEvents, /*Integer*/ index)
    {
        // summary:
        //   Takes a control event string and parses it into a
        //   more usable indexed array.
        //
        // description:
        //   Some control states did not work correctly when a mouseleave
        //   occured when scrolling. Event states were then tracked and
        //   checked again when the page mouse events were called.
        //
        // arguments:
        //   controlEvents (required)
        //   index (optional)
        //
        // returns: Array
        
        if (controlEvents != null)
        {
            if (controlEvents.indexOf(";") != -1)
            {
                index = (index != null ? index : 0);
                controlEvents = controlEvents.split(";")[index];
            }
            else if (index > 0)
            {
                return [];
            }
            
            return controlEvents.split(",");
        }
        
        return [];
    }
    
    function ___PositionControl(/*Boolean*/ useInsert, /*Boolean*/ _useVerticalInner, /*Boolean*/ _useHorizontalInner, /*Boolean*/ _verticalAdjust)
    {
        // summary:
        //   Figures out the correct position and dimensions
        //   for the scrollbars.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        var p0 = { Width: __System.Convert._IsNullToDefault(__this.Width, __origSize.Width) - __this.Left - __this.Right - (__this.BorderStyle != null ? __this.BorderSize * 2 : 0), Height: __System.Convert._IsNullToDefault(__this.Height, __origSize.Height) - __this.Top - __this.Bottom - (__this.BorderStyle != null ? __this.BorderSize * 2 : 0) };
        
        var b1 = _useVerticalInner;
        var b2 = _useHorizontalInner;
        var bVertical = true;
        var bHorizontal = true;
        
        if (!b1)
        {
            __vScrollBar.Height = p0.Height;
        }
        
        if (!b2)
        {
            __hScrollBar.Width = p0.Width;
        }
        
        with (__scrollNode.style)
        {
            width = __vScrollBar.Height;
            height = __hScrollBar.Width;
        }
        
        if (__this.HorizontalScrollBar)
        {
            __contentNode.style.width = 0;
        }
        
        var p1 = { X: __this.Left, Y: __this.Top };
        
        __vScrollBar.Location.X = (___IsDockReversed(__vScrollBar.Name) ? 0 : p0.Width) + p1.X;
        __vScrollBar.Location.Y = p1.Y;
        __hScrollBar.Location.X = p1.X;
        __hScrollBar.Location.Y = (___IsDockReversed(__hScrollBar.Name) ? 0 : p0.Height) + p1.Y;
        
        var bVScrollBarVisible = false;
        var bHScrollBarVisible = false;
        
        if (__this.VerticalScrollBar)
        {
            var o = __this.VScrollBar;
            
            var n = ___ContentSize(__vScrollBar.Name) + ___OffsetShaft(__hScrollBar.Name);
            
            if (__this._ScrollTop() != 0 && Math.abs(__this._ScrollTop()) > n)
            {
                ___ScrollTo(n, __vScrollBar.Name, false, true);
            }
            
            var bVertical = (___ContentSize(__vScrollBar.Name, true) + ((_useHorizontalInner != null && !_useHorizontalInner ? -1 : 1) * ___OffsetShaft(__hScrollBar.Name, _useHorizontalInner)) <= 0);
            
            if (o.AlwaysVisible || !bVertical)
            {
                bVScrollBarVisible = true;
            }
            
            var n = ___ScrollBarFixedSize(true);
            
            if (___IsDockReversed(__vScrollBar.Name))
            {
                if (o.AlwaysVisible || !bVertical)
                {
                    p0.Width -= n;
                    p1.X += n;
                    __hScrollBar.Location.X += n;
                    
                    if (__vScrollBar.Disabled)
                    {
                        b1 = true;
                    }
                }
                else if (bVertical)
                {
                    if (!__vScrollBar.Disabled)
                    {
                        b1 = false;
                    }
                }
            }
            else
            {
                if (o.AlwaysVisible || !bVertical)
                {
                    p0.Width -= n;
                    __vScrollBar.Location.X -= n;
                    
                    if (__vScrollBar.Disabled)
                    {
                        b1 = true;
                    }
                }
                else
                {
                    if (!__vScrollBar.Disabled)
                    {
                        b1 = false;
                    }
                }
            }
        }
        
        if (__this.HorizontalScrollBar)
        {
            var o = __this.HScrollBar;
            
            var n = ___ContentSize(__hScrollBar.Name) + ___OffsetShaft(__vScrollBar.Name);
            
            if (Math.abs(__this._ScrollLeft()) > n)
            {
                ___ScrollTo(n, __hScrollBar.Name, false, true);
            }
            else if (___IsRightToLeft() && Math.abs(Math.abs(__this._ScrollLeft()) - n) > n)
            {
                ___ScrollTo(0, __hScrollBar.Name, false, true);
            }
            
            var bHorizontal = (___ContentSize(__hScrollBar.Name, true) + ((_useVerticalInner != null && !_useVerticalInner ? -1 : 1) * ___OffsetShaft(__vScrollBar.Name, _useVerticalInner)) <= 0);
            
            if (o.AlwaysVisible || !bHorizontal)
            {
                bHScrollBarVisible = true;
            }
            
            var n = ___ScrollBarFixedSize(false);
            
            if (___IsDockReversed(__hScrollBar.Name))
            {
                if (o.AlwaysVisible || !bHorizontal)
                {
                    p0.Height -= n;
                    p1.Y += n;
                    __vScrollBar.Location.Y += n;
                    
                    if (__hScrollBar.Disabled)
                    {
                        b2 = true;
                        
                        if (!_verticalAdjust && _useHorizontalInner != null && __vScrollBar.Height != p0.Height)
                        {
                            __scrollNode.style.height = __vScrollBar.Height = p0.Height;
                            
                            if (bVertical && (__this._OffsetHeight() > __vScrollBar.Height))
                            {
                                ___PositionControl(useInsert, b1, b2, true);
                                return;
                            }
                        }
                    }
                }
                else
                {
                    if (!__hScrollBar.Disabled)
                    {
                        b2 = false;
                    }
                }
            }
            else
            {
                if (o.AlwaysVisible || !bHorizontal)
                {
                    p0.Height -= n;
                    __hScrollBar.Location.Y -= n;
                    
                    if (__hScrollBar.Disabled)
                    {
                        b2 = true;
                        
                        if (!_verticalAdjust && _useHorizontalInner != null && __vScrollBar.Height != p0.Height)
                        {
                            __scrollNode.style.height = __vScrollBar.Height = p0.Height;
                            
                            if (bVertical && (__this._OffsetHeight() > __vScrollBar.Height))
                            {
                                ___PositionControl(useInsert, b1, b2, true);
                                return;
                            }
                        }
                    }
                }
                else
                {
                    if (!__hScrollBar.Disabled)
                    {
                        b2 = false;
                    }
                }
            }
        }
        
        __vScrollBar.Height = p0.Height;
        __hScrollBar.Width = p0.Width;
        
        if ((_useVerticalInner == null && _useHorizontalInner == null) && (b1 != null || b2 != null))
        {
            ___PositionControl(useInsert, b1, b2);
        }
        else
        {
            with (__scrollNode.style)
            {
                left = p1.X;
                top = p1.Y;
                width = __hScrollBar.Width;
                height = __vScrollBar.Height;
            }
            
            if (__this.HorizontalScrollBar)
            {
                __contentNode.style.width = (___IsRightToLeft() && !bHorizontal ? 0 : "");
            }
            
            if (__this.VerticalScrollBar)
            {
                var bVisible = __this.VScrollBar.Visible;
                
                if (useInsert || __vScrollBar.Disabled != bVertical)
                {
                    __vScrollBar.Disabled = bVertical;
                    ___Insert(__vScrollBar.Name);
                }
                else if (__vScrollBar.Inserted)
                {
                    ___ResizeControl(__vScrollBar.Name);
                }
                
                if (__vScrollBar.Disabled)
                {
                    ___ScrollTo(0, __vScrollBar.Name, true, true);
                }
                
                if (bVScrollBarVisible != bVisible)
                {
                    __this.VScrollBar.Visible = bVScrollBarVisible;
                    
                    if (typeof __this.VScrollBar.OnVisibleChanged == "function")
                    {
                        __this.VScrollBar.OnVisibleChanged(__this);
                    }
                }
            }
            
            if (__this.HorizontalScrollBar)
            {
                var bVisible = __this.HScrollBar.Visible;
                
                if (useInsert || __hScrollBar.Disabled != bHorizontal)
                {
                    __hScrollBar.Disabled = bHorizontal;
                    ___Insert(__hScrollBar.Name);
                }
                else if (__hScrollBar.Inserted)
                {
                    ___ResizeControl(__hScrollBar.Name);
                }
                
                if (__hScrollBar.Disabled)
                {
                    ___ScrollTo(0, __hScrollBar.Name, true, true);
                }
                
                if (bHScrollBarVisible != bVisible)
                {
                    __this.HScrollBar.Visible = bHScrollBarVisible;
                    
                    if (typeof __this.HScrollBar.OnVisibleChanged == "function")
                    {
                        __this.HScrollBar.OnVisibleChanged(__this);
                    }
                }
            }
        }
    }
    
    function ___ProcessDrag(/*Event*/ evt)
    {
        // summary:
        //   Scrolls the content based on the mouse offset since
        //   the initial drag was started.
        //
        // arguments:
        //   evt (required)
        //
        // returns: Nothing
        
        if (__dragActive)
        {
            var o = ___Current();
            
            if (o._SystemVars != null && !o._SystemVars.Disabled)
            {
                var y0 = Math.max(0, (__vScrollBar.Enabled ? __System.Controls.DOM.ConvertPoint(evt).Y - __dragLocation.Y : __System.Controls.DOM.ConvertPoint(evt).X - __dragLocation.X));
                var y1 = ___MoveThumb(y0);
                
                if (__dragDistance > 0 && (o._UserVars.ShowHoverEffect || o._UserVars.ShowFadeEffect))
                {
                    ___ResetFade(o.sectionName, __controlName + "$Thumb$1$" + o.sectionName, 3);
                    ___SetAllControls(o.sectionName, 3, true, true);
                }
                
                __dragDistance += Math.abs(y1 - Math.abs((o.isVertical ? __this._ScrollTop() : __this._ScrollLeft())));
                
                ___ScrollTo(y1, o.sectionName, true);
            }
            else
            {
                ___EndDrag();
            }
        }
    }
    
    function ___RemoveEventFocus()
    {
        __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseMove, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseWheel, __this);
        
        __this.ContainsFocus = false;
    }
    
    function ___ResetFade(/*String*/ section, /*String*/ control, /*Integer*/ state)
    {
        // summary:
        //   Finalizes or cancels the fade state for the control
        //   by clearing the interval timer and making the fade
        //   layer invisible.
        //
        // arguments:
        //   section (required)
        //   control (required)
        //   state (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            var o1 = document.getElementById(control);
            
            if (o1 != null)
            {
                clearTimeout(o1.intervalTimer);
                o1.intervalTimer = null;
                
                ___SetFadeOpacity(control, __fadeMinOpacity);
                
                if (state != null)
                {
                    o1.imageState = state;
                }
            }
        }
    }
    
    function ___ResetShaft(/*Integer*/ resetTime)
    {
        // summary:
        //   Pauses the shaft procedure typically during a mousedown
        //   event so that it can be resumed.
        //
        // arguments:
        //   useResetTime (optional)
        //
        // returns: Nothing
        
        clearTimeout(__shaftTimer);
        __shaftTimer = null;
        
        if (resetTime != null)
        {
            setTimeout(__controlName + "._SetShaft(false)", resetTime);
        }
        else
        {
            __this._SetShaft(false);
        }
    }
    
    function ___ResizeControl(/*String*/ section)
    {
        var o = ___Current(section);
        
        if (o._SystemVars != null && o._SystemVars.Inserted)
        {
            if (!___EnableArrows(o.sectionName, true))
            {
                with (document.getElementById(__controlName + "$Shaft$0$" + o.sectionName).style)
                {
                    left = o._SystemVars.Location.X;
                    top = o._SystemVars.Location.Y;
                    width = __System.Convert._IsNullToDefault(o._UserVars.Width, o._SystemVars.Width);
                    height = __System.Convert._IsNullToDefault(o._UserVars.Height, o._SystemVars.Height);
                }
                
                with (document.getElementById(__controlName + "$Control$Shaft$" + o.sectionName).style)
                {
                    if (o.isVertical)
                    {
                        height = ___OffsetScrollBar(o.sectionName);
                    }
                    else
                    {
                        width = ___OffsetScrollBar(o.sectionName);
                    }
                }
                
                if (o._SystemVars.ControlVisible)
                {
                    with (document.getElementById(__controlName + "$Control$Down$Position$" + o.sectionName).style)
                    {
                        if (o.isVertical)
                        {
                            top = __System.Convert._IsNullToDefault(__this.VScrollBar.Height, __vScrollBar.Height) - (o._SystemVars.ControlSize.Height + (o._SystemVars.ControlPadding * 2));
                        }
                        else
                        {
                            left = __System.Convert._IsNullToDefault(__this.HScrollBar.Width, __hScrollBar.Width) - (o._SystemVars.ControlSize.Width + (o._SystemVars.ControlPadding * 2));
                        }
                    }
                }
                
                if (!o._SystemVars.Disabled)
                {
                    with (document.getElementById(__controlName + "$Shaft$1$" + o.sectionName).style)
                    {
                        width = __System.Convert._IsNullToDefault(o._UserVars.Width, o._SystemVars.Width);
                        height = __System.Convert._IsNullToDefault(o._UserVars.Height, o._SystemVars.Height);
                    }
                    
                    if (o._SystemVars.ThumbEnabled)
                    {
                        ___ResizeThumb(o.sectionName);
                    }
                }
            }
        }
    }
    
    function ___ResizeThumb(/*String*/ section)
    {
        var o = ___Current(section);
        
        if (o._SystemVars != null && o._SystemVars.ThumbEnabled)
        {
            var n = (___ContentSize(o.sectionName) < ___OffsetScrollBar(o.sectionName) - o._SystemVars.ThumbMinHeight ? ___OffsetScrollBar(o.sectionName) - ___ContentSize(o.sectionName) : o._SystemVars.ThumbMinHeight);
            
            if (o.isVertical)
            {
                __vScrollBar.ThumbSize.Height = n;
            }
            else
            {
                __hScrollBar.ThumbSize.Width = n;
            }
            
            var thumbSize = ___ThumbSize(o.isVertical);
            
            var b = (thumbSize > o._SystemVars.ThumbGripHeight && thumbSize > o._SystemVars.ThumbTopHeight + o._SystemVars.ThumbBottomHeight);
            
            with (document.getElementById(__controlName + "$Thumb$0$Background$" + o.sectionName).style)
            {
                if (o.isVertical)
                {
                    height = (thumbSize - o._SystemVars.ThumbMinHeight);
                    
                    __System.Controls.DOM.SetDisplay(__controlName + "$Thumb$0$Row$1$" + o.sectionName, (thumbSize > o._SystemVars.ThumbMinHeight));
                }
                else
                {
                    width = (thumbSize - o._SystemVars.ThumbMinHeight);
                }
            }
            
            var n = Math.floor((thumbSize - o._SystemVars.ThumbGripHeight) / 2);
            
            with (document.getElementById(__controlName + "$Thumb$0$Grip$" + o.sectionName).style)
            {
                if (o.isVertical)
                {
                    top = n;
                }
                else
                {
                    left = n;
                }
            }
            
            __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$0$Grip$" + o.sectionName, b && n > 0);
            
            if (o._UserVars.ShowFadeEffect)
            {
                with (document.getElementById(__controlName + "$Thumb$1$Background$" + o.sectionName).style)
                {
                    if (o.isVertical)
                    {
                        height = (thumbSize - o._SystemVars.ThumbMinHeight);
                    }
                    else
                    {
                        width = (thumbSize - o._SystemVars.ThumbMinHeight);
                    }
                }
                
                with (document.getElementById(__controlName + "$Thumb$1$Grip$" + o.sectionName).style)
                {
                    if (o.isVertical)
                    {
                        top = n;
                    }
                    else
                    {
                        left = n;
                    }
                }
                
                __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$1$Grip$" + o.sectionName, b && n > 0);
            }
            
            with (document.getElementById(__controlName + "$Thumb$" + o.sectionName).style)
            {
                if (o.isVertical)
                {
                    height = thumbSize;
                    
                    __System.Controls.DOM.SetDisplay(__controlName + "$Thumb$1$Row$1$" + o.sectionName, (thumbSize > o._SystemVars.ThumbMinHeight));
                }
                else
                {
                    width = thumbSize;
                }
                
                if (!o.isVertical && ___IsRightToLeft())
                {
                    if (!__this.Created)
                    {
                        var y = ___MoveThumb(___ScrollSize(o.sectionName), o.sectionName);
                        ___ScrollTo(y, o.sectionName, true);
                    }
                }
                else
                {
                    left = o._SystemVars.ThumbLocation.X;
                }
                
                top =  o._SystemVars.ThumbLocation.Y;
                
                if (__this.Created)
                {
                    if (!o.isVertical && ___IsRightToLeft())
                    {
                        ___ScrollTo(___ContentSize(o.sectionName) - __scrollPosition.X, o.sectionName);
                    }
                    else
                    {
                        ___MoveThumbByScrollPosition(Math.abs((o.isVertical ? __this._ScrollTop() : __this._ScrollLeft())), o.sectionName)
                    }
                }
            }
        }
    }
    
    function ___ScrollBarFixedSize(/*Boolean*/ isVertical)
    {
        return (isVertical ? __System.Convert._IsNullToDefault(__this.VScrollBar.Width, __vScrollBar.Width) : __System.Convert._IsNullToDefault(__this.HScrollBar.Height, __hScrollBar.Height));
    }
    
    function ___ScrollByDirection(/*Integer*/ yOffset, /*Boolean*/ calculateResult, /*String*/ section, /*Integer*/ dirScroll)
    {
        // summary:
        //   Takes a positive value with a directional variable to
        //   determine the amount the content region is scrolled
        //   and also updates the scrollbar thumb.
        //
        // arguments:
        //   yOffset (required)
        //   calculateResult (optional)
        //   section (optional)
        //   dirScroll (optional)
        //
        // returns: Integer
        
        var b = false;
        var o1 = { Content: null, Thumb: null };
        
        section = ___FindSection(section);
        
        if (section != null)
        {
            var o = ___Current(section);
            
            if (!isNaN(parseInt(yOffset)))
            {
                if (o._SystemVars != null && !o._SystemVars.Disabled)
                {
                    b = true;
                    dirScroll = (dirScroll != null ? dirScroll : __scrollDirection);
                    
                    var p = parseInt((o.isVertical ? __contentNode.style.top : __contentNode.style.left));
                    
                    var y0 = ___ContentSize(o.sectionName);
                    var y1 = (dirScroll * yOffset) - p;
                    var y2 = __System.Convert._IsNullToDefault((o.isVertical ? __this.VScrollBar.Minimum : __this.HScrollBar.Minimum), 0);
                    
                    y0 += y2;
                    
                    if (dirScroll == 1 && y0 < Math.abs(y1))
                    {
                        y1 = y0;
                        b = false;
                    }
                    else if (dirScroll == -1 && y1 <= y2)
                    {
                        y1 = y2;
                        b = false;
                    }
                    
                    with (__contentNode.style)
                    {
                        if (calculateResult)
                        {
                            o1.Content = { y: y1, canScrollAfter: b, canScrollBefore: (dirScroll == -1 && Math.abs(p) > y2) || (dirScroll == 1 && Math.abs(p) < y0) };
                        }
                        else
                        {
                            if (o.isVertical)
                            {
                                top = -y1;
                                __scrollPosition.Y = y1;
                            }
                            else
                            {
                                left = -y1;
                                __scrollPosition.X = (___IsRightToLeft() ? y0 - y1 : y1);
                            }
                        }
                        
                        y0 = ___MoveThumbByScrollPosition(y1, o.sectionName, calculateResult);
                        
                        if (o._SystemVars.ThumbEnabled && calculateResult)
                        {
                            o1.Thumb = { X: (o.isVertical ? parseInt(left) : y0), Y: (o.isVertical ? y0 : parseInt(top)) };
                        }
                    }
                    
                    if (!calculateResult && typeof __this.OnScroll == "function")
                    {
                        __this.OnScroll(__this);
                    }
                }
            }
        }
        
        return (calculateResult ? o1 : b);
    }
    
    function ___ScrollSize(/*String*/ section)
    {
        // summary:
        //   Returns the amount which the scrollbar has available
        //   to scroll.
        //
        // arguments:
        //   section (required)
        //
        // returns: Integer
        
        var o = ___Current(section);
        
        return (o._SystemVars != null && !o._SystemVars.Disabled ? ___OffsetScrollBar(o.sectionName) - (o._SystemVars.ThumbEnabled ? ___ThumbSize(o.isVertical) : 0) : 0);
    }
    
    function ___ScrollTo(/*Integer*/ yPosition, /*String*/ section, /*Boolean*/ bypassThumb, /*Boolean*/ bypassDisabled)
    {
        // summary:
        //   Moves the content region directly to the requested
        //   position.
        //
        // arguments:
        //   yPosition (required)
        //   section (optional)
        //   bypassThumb (optional)
        //   bypassDisabled (optional)
        //
        // returns: Integer
        
        if (!isNaN(parseInt(yPosition)))
        {
            var b = ___FindSection(section);
            
            if (b != null)
            {
                var o = ___Current(b);
                
                if (o._SystemVars != null && (!o._SystemVars.Disabled || bypassDisabled))
                {
                    var y0 = ___ContentSize(o.sectionName) + (___IsRightToLeft() && !o.isVertical ? 0 : ___OffsetShaft(___SwapSection(o.sectionName)));
                    var y1 = __System.Convert._IsNullToDefault((o.isVertical ? __this.VScrollBar.Minimum : __this.HScrollBar.Minimum), 0);
                    
                    y0 += y1;
                    
                    var y2 = Math.max(y1, Math.min(yPosition, y0));
                    
                    with (__contentNode.style)
                    {
                        if (o.isVertical)
                        {
                            top = -y2;
                            __scrollPosition.Y = y2;
                        }
                        else
                        {
                            left = -y2;
                            __scrollPosition.X = (___IsRightToLeft() ? y0 - y2 : y2);
                        }
                    }
                    
                    if (!bypassThumb)
                    {
                        ___MoveThumbByScrollPosition(y2, o.sectionName);
                    }
                    
                    if (typeof __this.OnScroll == "function")
                    {
                        __this.OnScroll(__this);
                    }
                }
            }
        }
    }
    
    function ___SetAllControls(/*String*/ section, /*Integer*/ state, /*Boolean*/ bypassControls, /*Boolean*/ bypassAll, /*Integer*/ controlIndex)
    {
        // summary:
        //   Updates every control in a scrollbar at the same time.
        //
        // arguments:
        //   section (required)
        //   state (required)
        //   bypassControls (optional)
        //   bypassAll (optional)
        //   controlIndex (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null && !o._SystemVars.Disabled && (!__shaftActive || bypassAll))
        {
            controlIndex = (controlIndex != null ? controlIndex : 0);
            
            if (o._SystemVars.ControlVisible && !bypassControls)
            {
                document.getElementById(__controlName + "$Control$Up$" + controlIndex + "$" + o.sectionName).src = __resources[o.sectionName + (o.isVertical ? "Up" : "Left")].Build(state);
                document.getElementById(__controlName + "$Control$Down$" + controlIndex + "$" + o.sectionName).src = __resources[o.sectionName + (o.isVertical ? "Down" : "Right")].Build(state);
            }
            
            if (o._SystemVars.ThumbEnabled)
            {
                document.getElementById(__controlName + "$Thumb$" + controlIndex + "$Top$" + o.sectionName).style.backgroundImage = "url(" + __resources[o.sectionName + "Thumb" + (o.isVertical ? "Top" : "Left")].Build(state) + ")";
                document.getElementById(__controlName + "$Thumb$" + controlIndex + "$Background$" + o.sectionName).style.backgroundImage = "url(" + __resources[o.sectionName + "ThumbBg"].Build(state) + ")";
                document.getElementById(__controlName + "$Thumb$" + controlIndex + "$Bottom$" + o.sectionName).style.backgroundImage = "url(" + __resources[o.sectionName + "Thumb" + (o.isVertical ? "Bottom" : "Right")].Build(state) + ")";
                document.getElementById(__controlName + "$Thumb$" + controlIndex + "$Grip$Image$" + o.sectionName).src = __resources[o.sectionName + "ThumbGrip"].Build(state);
            }
        }
    }
    
    function ___SetFadeOpacity(/*String*/ control, /*Integer*/ opacity)
    {
        // summary:
        //   Updates the current opacity of the control.
        //
        // arguments:
        //   control (required)
        //   opacity (required)
        //
        // returns: Nothing
        
        var o1 = document.getElementById(control);
        
        if (o1 != null)
        {
            __System.Controls.DOM.SetOpacity(o1, opacity);
            o1.curOpacity = opacity;
        }
    }
    
    function ___SetImage(/*Event*/ evt, /*String*/ section, /*String*/ button, /*Integer*/ state, /*Boolean*/ bypassEvents, /*Boolean*/ bypassAll, /*Integer*/ controlIndex)
    {
        // summary:
        //   Takes care of both control events and system routine
        //   calls to update the image directly or initiating the
        //   fade procedure.  
        //
        // arguments:
        //   evt (required)
        //   section (required)
        //   button (required)
        //   state (required)
        //   bypassEvents (optional)
        //   bypassAll (optional)
        //   controlIndex (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            var resource = o.sectionName + (o.isVertical ? button : (button == "Up" ? "Left" : "Right"));
            var idx = ___ParseStates(o._SystemVars.ControlEventInfo);
            
            if (__scrollEventSection != null && !bypassEvents && !bypassAll)
            {
                if (o.sectionName != __scrollEventSection)
                {
                    var o = ___Current(o.sectionName);
                    
                    if (evt.type == "mouseenter")
                    {
                        o._SystemVars.ControlEventInfo = o.sectionName + "," + button + "," + state;
                    }
                    else if (evt.type == "mouseleave")
                    {
                        o._SystemVars.ControlEventInfo = null;
                    }
                    
                    return;
                }
                else if (o.sectionName == __scrollEventSection && button != idx[1])
                {
                    if (evt.type == "mouseenter" && o._SystemVars.ControlEventInfo != null && o._SystemVars.ControlEventInfo.search(button) == -1)
                    {
                        o._SystemVars.ControlEventInfo += ";" + button + "," + evt.type;
                    }
                    else if (evt.type == "mouseleave" && o._SystemVars.ControlEventInfo != null)
                    {
                        o._SystemVars.ControlEventInfo = o._SystemVars.ControlEventInfo.split(";")[0];
                    }
                    
                    return;
                }
            }
            
            if (!o._SystemVars.Disabled && o._UserVars.ShowHoverEffect && (!__dragActive || bypassEvents || bypassAll))
            {
                if (!bypassEvents)
                {
                    var b = true;
                    
                    if (evt.type == "mouseenter")
                    {
                        if (__shaftActive)
                        {
                            return;
                        }
                        else if (o._SystemVars.ControlEventInfo != null)
                        {
                            if (idx.length == 4 && o.sectionName == idx[0] && button == idx[1])
                            {
                                state = Math.min(parseInt(idx[2]) + 1, __resources[resource].State.length - 1);
                                o._SystemVars.ControlEventInfo = idx[0] + "," + idx[1] + "," + state + "," + evt.type;
                                
                                __this._InvokeArrowUpEvent(o.sectionName, true);
                            }
                        }
                    }
                    else if (evt.type == "mouseleave")
                    {
                        b = false;
                        
                        if (o._SystemVars.ControlEventInfo != null)
                        {
                            if (idx.length == 4 && o.sectionName == idx[0] && button == idx[1])
                            {
                                clearTimeout(o._SystemVars.ControlTimer);
                                o._SystemVars.ControlTimer = -1;
                                
                                state = Math.max(0, parseInt(idx[2]) - 1);
                                o._SystemVars.ControlEventInfo = idx[0] + "," + idx[1] + "," + state + "," + evt.type;
                            }
                            else
                            {
                                o._SystemVars.ControlEventInfo = null;
                            }
                        }
                    }
                    
                    if (b && (o._SystemVars.ControlEventInfo == null || ___ParseStates(o._SystemVars.ControlEventInfo).length == 3))
                    {
                        o._SystemVars.ControlEventInfo = o.sectionName + "," + button + "," + state;
                    }
                }
                
                if (o._UserVars.ShowFadeEffect && !bypassAll)
                {
                    ___BeginFade(o.sectionName, __controlName + "$Control$" + button + "$1$" + o.sectionName, state);
                }
                else
                {
                    controlIndex = (controlIndex != null ? controlIndex : 0);
                    document.getElementById(__controlName + "$Control$" + button + "$" + controlIndex + "$" + o.sectionName).src = __resources[resource].Build(state);
                }
            }
        }
    }
    
    function ___SetControlEventHandler(/*String*/ elementName)
    {
        // summary:
        //   Attaches the mouse events to the controls.
        //
        // arguments:
        //   elementName (required)
        //
        // returns: Nothing
        
        with (document.getElementById(elementName))
        {
            onmouseenter = function()
            {
                if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                {
                    ___ResetShaft();
                    ___SetImage(event, this.sectionName, this.dirControl, 2);
                }
            }
            
            onmouseleave = function()
            {
                if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                {
                    ___SetImage(event, this.sectionName, this.dirControl, 1);
                }
            }
            
            onmousedown = function()
            {
                if (___TryEventMouseClick(__this))
                {
                    ___SetImage(event, this.sectionName, this.dirControl, 3);
                    ___InvokeArrowDownEvent(this.sectionName, (this.dirControl == "Up" ? -1 : 1), event);
                }
            }
            
            onmouseup = function()
            {
                if (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                {
                    ___SetImage(event, this.sectionName, this.dirControl, 2);
                    __this._InvokeArrowUpEvent(this.sectionName);
                    ___InvokeArrowCancelEvent(event, this.sectionName, true);
                }
            }
        }
    }
    
    function ___SwapSection(/*String*/ section)
    {
        // summary:
        //   Checks to see if the opposite scrollbar has been
        //   enabled and returns the section name.
        //
        // arguments:
        //   section (required)
        //
        // returns: String
        
        if (section != null)
        {
            if (section == __vScrollBar.Name && __this.HorizontalScrollBar)
            {
                return __hScrollBar.Name;
            }
            else if (section == __hScrollBar.Name && __this.VerticalScrollBar)
            {
                return __vScrollBar.Name;
            }
        }
        
        return null;
    }
    
    function ___SwitchTo(/*String*/ section)
    {
        // summary:
        //   Changes the context to the section provided or
        //   resets all scrollbars to an inactive state.
        //
        // arguments:
        //   section (optional)
        //
        // returns: Nothing
        
        var o = null;
        
        if (section != null)
        {
            o = ___Current(section);
            
            if (o._SystemVars != null)
            {
                __scrollPrevSection = section;
            }
        }
        
        __vScrollBar.Enabled = false;
        __hScrollBar.Enabled = false;
        
        if (o != null && o._SystemVars != null)
        {
            __vScrollBar.Enabled = o.isVertical;
            __hScrollBar.Enabled = !__vScrollBar.Enabled;
        }
    }
    
    function ___ThumbFixedSize(/*Boolean*/ isVertical)
    {
        return (isVertical ? __vScrollBar.ThumbSize.Width : __hScrollBar.ThumbSize.Height);
    }
    
    function ___ThumbSize(/*Boolean*/ isVertical)
    {
        return (isVertical ? __vScrollBar.ThumbSize.Height : __hScrollBar.ThumbSize.Width);
    }
    
    function ___TryEventFocus(/*Boolean*/ focusControl)
    {
        if (__System.Threading.Monitor.TryEnter(__System.Controls.EventType.MouseMove, __this))
        {
             if (focusControl)
             {
                if (__this.Parent != null && typeof __this.Parent.Focus == "function")
                {
                    __this.Parent.Focus();
                    return true;
                }
                else
                {
                    __pageNode.focus();
                }
             }
             
             __System.Threading.Monitor.Enter(__System.Controls.EventType.MouseWheel, __this);
             
             __this.ContainsFocus = true;
             
             return true;
        }
        else
        {
            ___RemoveEventFocus();
            
            return false;
        }
    }
    
    this._EnsureVisible = function(/*Node*/ element, /*Integer*/ offsetLeft, /*Boolean*/ bypassVScroll, /*Boolean*/ bypassHScroll)
    {
        // summary:
        //   User procedure to move a section into the visible
        //   content region.
        //
        // arguments:
        //   element (required)
        //   offsetLeft (optional)
        //   bypassVScroll (optional)
        //   bypassHScroll (optional)
        //
        // returns: Nothing
        
        var o = __System.Controls.DOM.Bounds(element, __contentNode);
        
        if (o != null)
        {
            if (!__vScrollBar.Disabled && !bypassVScroll)
            {
                if (o.Y <= Math.abs(this._ScrollTop()))
                {
                    ___ScrollTo(o.Y, __vScrollBar.Name);
                }
                else if (o.Y + o.Height > Math.abs(this._ScrollTop()) + ___OffsetScrollSize(true))
                {
                    ___ScrollTo(o.Y + o.Height - ___OffsetScrollSize(true), __vScrollBar.Name);
                }
            }
            
            if (!__hScrollBar.Disabled && !bypassHScroll)
            {
                var p0 = Math.abs(this._ScrollLeft());
                var p1 = ___OffsetScrollSize(false);
                
                if (___IsRightToLeft())
                {
                    if (offsetLeft != null)
                    {
                        o.X = offsetLeft;
                    }
                    
                    p0 = ___ContentSize(__hScrollBar.Name) - p0;
                    
                    if (o.X <= p0)
                    {
                        ___ScrollTo(___ContentSize(__hScrollBar.Name) - o.X, __hScrollBar.Name);
                    }
                    else if (o.X + o.Width > p0 + p1)
                    {
                        ___ScrollTo(___OffsetSize(__hScrollBar.Name) - (o.X + o.Width), __hScrollBar.Name);
                    }
                }
                else
                {
                    if (o.X <= p0)
                    {
                        ___ScrollTo(o.X, __hScrollBar.Name);
                    }
                    else if (o.X > p0 + p1 || o.X + o.Width > p0 + p1)
                    {
                        ___ScrollTo(Math.min(o.X + o.Width - p1, o.X), __hScrollBar.Name);
                    }
                }
            }
        }
    }
    
    this._IsElementVisible = function(/*Node*/ element, /*Integer*/ offsetLeft, /*Boolean*/ usePartial)
    {
        // summary:
        //   User procedure to check if a element is at least
        //   partially visible.
        //
        // arguments:
        //   element (required)
        //   offsetLeft (optional)
        //   usePartial (optional)
        //
        // returns: Nothing
        
        var o = __System.Controls.DOM.Bounds(element, __contentNode);
        
        if (o != null)
        {
            var p0 = Math.abs(this._ScrollLeft());
            
            if (___IsRightToLeft())
            {
                if (offsetLeft != null)
                {
                    o.X = offsetLeft;
                }
                
                p0 = ___ContentSize(__hScrollBar.Name) - p0;
            }
            
            var p1 = p0 + ___OffsetScrollSize(false);
            
            if (usePartial)
            {
                if (o.Y + o.Height >= Math.abs(this._ScrollTop()) && o.Y <= Math.abs(this._ScrollTop()) + ___OffsetScrollSize(true))
                {
                    if ((o.X >= p0 && o.X <= p1) || (o.X + o.Width >= p0 && o.X + o.Width <= p1))
                    {
                        return true;
                    }
                }
            }
            else
            {
                if (o.X >= p0 && o.X + o.Width <= p1 && o.Y >= Math.abs(this._ScrollTop()) && o.Y + o.Height <= Math.abs(this._ScrollTop()) + ___OffsetScrollSize(true))
                {
                    return true;
                }
            }
        }
        
        return false;
    }
        
    this._InvokeArrowUpEvent = function(/*String*/ section, /*Boolean*/ isRepeat)
    {
        // summary:
        //   Processes a single scroll or to continues to scroll
        //   until a mouseup event has occurred.
        //
        // arguments:
        //   section (required)
        //   isRepeat (optional)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null && !o._SystemVars.Disabled)
        {
            clearTimeout(o._SystemVars.ControlTimer);
            
            if (__scrollEventSection != null && __scrollEventSection != section)
            {
                return;
            }
            
            var b = true;
            
            if (__scrollDirection != null && (isRepeat || !o._SystemVars.ControlHasScrolled))
            {
                b = ___ScrollByDirection(__System.Convert._IsNullToDefault(o._UserVars.SmallChange, __arrowsIncrement), false, o.sectionName);
                o._SystemVars.ControlHasScrolled = true;
            }
            
            if (b && isRepeat)
            {
                o._SystemVars.ControlTimer = setTimeout(__controlName + "._InvokeArrowUpEvent('" + o.sectionName + "', true)", __arrowsSpeed);
            }
            else if (!isRepeat)
            {
                if (o._SystemVars.ControlEventInfo != null && ___ParseStates(o._SystemVars.ControlEventInfo, 1).length == 0)
                {
                    o._SystemVars.ControlEventInfo = null;
                }
                
                o._SystemVars.ControlTimer = null;
                o._SystemVars.ControlHasScrolled = false;
                
                __scrollEventSection = null;
                __scrollDirection = null;
            }
        }
    }
    
    this._ProcessFade = function(/*String*/ section, /*String*/ control, /*Integer*/ state)
    {
        // summary:
        //   Increases or decreases the opacity of the control
        //   until an upper or lower bound is reached.
        //
        // arguments:
        //   section (required)
        //   control (required)
        //   state (required)
        //
        // returns: Nothing
        
        var o = ___Current(section);
        
        if (o._SystemVars != null)
        {
            var o1 = document.getElementById(control);
            
            if (o1 != null)
            {
                var y;
                var b = false;
                
                if (o1.fadeDirection == 1)
                {
                    y = Math.min(o1.curOpacity + __fadeIncrement, __fadeMaxOpacity);
                    b = (y == __fadeMaxOpacity);
                }
                else if (o1.fadeDirection == -1)
                {
                    y = Math.max(__fadeMinOpacity, o1.curOpacity - __fadeIncrement);
                    b = (y == __fadeMinOpacity);
                }
                
                ___SetFadeOpacity(control, y);
                
                if (!b)
                {
                    o1.intervalTimer = setTimeout(__controlName + "._ProcessFade('" + o.sectionName + "', '" + control + "', " + state + ")", __fadeSpeed);
                }
                else
                {
                    ___EndFade(o.sectionName, control, state);
                }
            }
        }
    }
    
    this._MoveShaft = function()
    {
        // summary:
        //   Tests to see if the shaft can be moved based on the
        //   current mouse position and then scrolls the content
        //   one page at a time.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (__shaftActive)
        {
            var o = ___Current();
            
            if (o._SystemVars != null)
            {
                var b = false;
                var b1 = true;
                
                var y0 = __System.Convert._IsNullToDefault(o._UserVars.LargeChange, ___OffsetScrollSize(o.isVertical));
                var o1 = ___ScrollByDirection(y0, true);
                
                if (o._SystemVars.ThumbEnabled)
                {
                    var p = __System.Controls.DOM.Size(__controlName + "$Thumb$" + o.sectionName);
                    p.X = o1.Thumb.X;
                    p.Y = o1.Thumb.Y;
                    
                    var x1 = __shaftLocation.X - (__origLocation.X + o._SystemVars.Location.X);
                    var y1 = __shaftLocation.Y - (__origLocation.Y + o._SystemVars.Location.Y);
                    
                    b = __System.Controls.DOM.IsPointWithin(p, {X: x1, Y: y1});
                    b1 = __System.Controls.DOM.IsPointWithin(p, {X: x1, Y: y1}, __scrollDirection, o.isVertical);
                }
                
                if (o._SystemVars.ThumbEnabled && o1.Content.canScrollBefore && !b && !b1)
                {
                    var p0 = __System.Controls.DOM.Location(__controlName + "$Thumb$" + o.sectionName);
                    var y1 = null;
                    
                    if (o.isVertical)
                    {
                        y1 = ___MoveThumb(__System.Controls.DOM.ConvertPointToRTL({ Y: __shaftLocation.Y - (__origLocation.Y + o._SystemVars.Location.Y + o._SystemVars.ThumbLocation.Y) - __shaftOffset }).Y, o.sectionName, (__shaftIteration != 0));
                    }
                    else
                    {
                        y1 = ___MoveThumb(__System.Controls.DOM.ConvertPointToRTL({ X: __shaftLocation.X - (__origLocation.X + o._SystemVars.Location.X + o._SystemVars.ThumbLocation.X) - __shaftOffset }).X, o.sectionName, (__shaftIteration != 0));
                    }
                    
                    if (__shaftIteration == 0)
                    {
                        var p1 = __System.Controls.DOM.Location(__controlName + "$Thumb$" + o.sectionName);
                        
                        if (___ThumbSize(o.isVertical) > Math.abs((o.isVertical ? p0.Y - p1.Y : p0.X - p1.X)))
                        {
                            var n = (o.isVertical ? p0.Y - o._SystemVars.ThumbLocation.Y : p0.X - o._SystemVars.ThumbLocation.X) + (__scrollDirection * ___ThumbSize(o.isVertical));
                            y1 = ___MoveThumb((o.isVertical ? __System.Controls.DOM.ConvertPointToRTL({ Y: n }).Y : __System.Controls.DOM.ConvertPointToRTL({ X: n }).X), o.sectionName, true);
                        }
                    }
                    
                    ___EndShaft();
                    
                    var n = Math.abs((o.isVertical ? __this._ScrollTop() : __this._ScrollLeft()));
                    
                    if ((__scrollDirection == -1 && y1 < n) || (__scrollDirection == 1 && y1 > n))
                    {
                        ___ScrollTo(y1, o.sectionName);    
                    }
                    
                    return;
                }
                else if ((o1.Content.canScrollBefore && !o1.Content.canScrollAfter) || b || b1)
                {
                    ___ScrollByDirection(y0);
                    this._SetShaft(true);
                }
                
                if (o1.Content.canScrollAfter && !b)
                {
                    __shaftTimer = setTimeout(__controlName + "._MoveShaft()", (__shaftIteration == 0 ? __shaftDelayPress : __shaftSpeed));
                    __shaftIteration++;
                }
                else
                {
                    __shaftTimer = null;
                    setTimeout(__controlName + "._SetShaft(false)", __shaftResetTime);
                }
            }
        }
    }
    
    this._OffsetHeight = function()
    {
        // summary:
        //   User procedure to retrieve the offset height.
        //
        // arguments:
        //   text (required)
        //
        // returns: Nothing
        
        return (__contentNode != null ? (this.VerticalScrollBar ? __System.Convert._IsNullToDefault(this.VScrollBar.Maximum, parseInt(__contentNode.offsetHeight)) - __System.Convert._IsNullToDefault(this.VScrollBar.Minimum, 0) : parseInt(__contentNode.offsetHeight)) : 0);
    }
    
    this._OffsetWidth = function()
    {
        // summary:
        //   User procedure to retrieve the offset width.
        //
        // arguments:
        //   text (required)
        //
        // returns: Nothing
        
        return (__contentNode != null ? (this.HorizontalScrollBar ? __System.Convert._IsNullToDefault(this.HScrollBar.Maximum, parseInt(__contentNode.offsetWidth)) - __System.Convert._IsNullToDefault(this.HScrollBar.Minimum, 0) : parseInt(__contentNode.offsetWidth)) : 0);
    }
    
    this._Refresh = function()
    {
        // summary:
        //   User procedure to adjust the scrollbar when content
        //   is resized.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (this.Created)
        {
            ___InsertControl();
        }
    }
    
    this._ScrollBarHeight = function()
    {
        return __vScrollBar.Height;
    }
    
    this._ScrollBarWidth = function()
    {
        return __hScrollBar.Width;
    }
    
    this._ScrollLeft = function()
    {
        // summary:
        //   User procedure to retrieve scroll left position.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return (__contentNode != null ? parseInt(__contentNode.style.left) : 0);
    }
    
    this._ScrollTo = function(/*Integer*/ yPosition, /*Boolean*/ isVertical)
    {
        // summary:
        //   User procedure to move the scroll position.
        //
        // arguments:
        //   yPosition (required)
        //   isVertical (required)
        //
        // returns: Nothing
        
        if (yPosition != null && isVertical != null)
        {
            ___ScrollTo(yPosition, isVertical);
        }
    }
    
    this._ScrollTop = function()
    {
        // summary:
        //   User procedure to retrieve scroll top position.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return (__contentNode != null ? parseInt(__contentNode.style.top) : 0);
    }
    
    this._SetShaft = function(/*Boolean*/ isVisible)
    {
        // summary:
        //   Uses the current thumb position to calculate the shaft
        //   highlight size.
        //
        // arguments:
        //   isVisible (required)
        //
        // returns: Nothing
        
        var o = ___Current((!isVisible && !__vScrollBar.Enabled && !__hScrollBar.Enabled ? __scrollPrevSection : null));
        
        if (o._SystemVars != null)
        {
            var o1 = document.getElementById(__controlName + "$Shaft$1$" + o.sectionName);
            
            if (o1 != null)
            {
                if (__shaftActive && isVisible)
                {
                    if (o._SystemVars.ThumbEnabled)
                    {
                        var y0 = (o.isVertical ? o._SystemVars.ThumbLocation.Y : o._SystemVars.ThumbLocation.X);
                        var y1 = 0;
                        
                        var h = ___OffsetScrollBar(o.sectionName);
                        
                        with (document.getElementById(__controlName + "$Thumb$" + o.sectionName).style)
                        {
                            y1 = parseInt(o.isVertical ? top : left);
                            
                            if ((__scrollDirection == 1 && y1 + ___ThumbSize(o.isVertical) >= h + y0) || (__scrollDirection == -1 && y1 <= y0))
                            {
                                ___EndShaft();
                                return;
                            }
                        }
                        
                        with (o1.style)
                        {
                            var y2 = (o._SystemVars.ControlVisible ? o._SystemVars.ControlPadding * __scrollDirection : 0);
                            
                            if (__scrollDirection == 1)
                            {
                                y1 += ___ThumbSize(o.isVertical);
                                
                                var y3 = h + y0 - y1;
                                
                                if (o.isVertical)
                                {
                                    top = y1;
                                    height = y3 + Math.abs(y2);
                                }
                                else
                                {
                                    left = y1;
                                    width = y3 + Math.abs(y2);
                                }
                            }
                            else if (__scrollDirection == -1)
                            {
                                y1 -= y0;
                                
                                if (o.isVertical)
                                {
                                    top = o._SystemVars.ThumbLocation.Y + y2;
                                    height = y1 + Math.abs(y2);
                                }
                                else
                                {
                                    left = o._SystemVars.ThumbLocation.X + y2;
                                    width = y1 + Math.abs(y2);
                                }
                            }
                        }
                    }
                    else
                    {
                        with (o1.style)
                        {
                            if (o.isVertical)
                            {
                                top = (o._SystemVars.ControlVisible ? o._SystemVars.ControlSize.Height + (o._SystemVars.ControlPadding * 2) : 0) + "px";
                                height = ___OffsetScrollBar(o.sectionName);
                            }
                            else
                            {
                                left = (o._SystemVars.ControlVisible ? o._SystemVars.ControlSize.Width + (o._SystemVars.ControlPadding * 2) : 0) + "px";
                                width = ___OffsetScrollBar(o.sectionName);
                            }
                        }
                    }
                }
                
                __System.Controls.DOM.SetVisibility(o1, (isVisible && __shaftActive));
            }
        }
    }
    
    this._Write = function(/*String*/ text, /*Boolean*/ bypassResize)
    {
        // summary:
        //   User procedure to insert content into control.
        //
        // arguments:
        //   text (required)
        //   bypassResize (optional)
        //
        // returns: Nothing
        
        if (typeof text != "undefined")
        {
            if (this.Created)
            {
                __contentNode.innerHTML = text;
                
                if (!bypassResize)
                {
                    this._Refresh();
                }
            }
        }
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
            
            if (this.VerticalScrollBar && __vScrollBar.Inserted)
            {
                __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$" + __vScrollBar.Name, __visible);
                __System.Controls.DOM.SetVisibility(__controlName + "$Shaft$0$" + __vScrollBar.Name, __visible);
                
                if (!__visible)
                {
                    __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$0$Grip$" + __vScrollBar.Name, __visible);
                    __System.Controls.DOM.SetVisibility(__controlName + "$Shaft$1$" + __vScrollBar.Name, __visible);
                }
            }
            
            if (this.HorizontalScrollBar && __hScrollBar.Inserted)
            {
                __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$" + __hScrollBar.Name, __visible);
                __System.Controls.DOM.SetVisibility(__controlName + "$Shaft$0$" + __hScrollBar.Name, __visible);
                
                if (!__visible)
                {
                    __System.Controls.DOM.SetVisibility(__controlName + "$Thumb$0$Grip$" + __hScrollBar.Name, __visible);
                    __System.Controls.DOM.SetVisibility(__controlName + "$Shaft$1$" + __hScrollBar.Name, __visible);
                }
            }
            
            __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            __System.Controls.DOM.SetVisibility(__scrollNode, __visible);
            __System.Controls.DOM.SetVisibility(__contentNode, __visible);
            
            if (!__visible)
            {
                ___RemoveEventFocus();
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
                if (this.PageID != null)
                {
                    __pageNode = document.getElementById(this.PageID);
                    
                    if (__pageNode != null)
                    {
                        if (typeof this.OnBeforeLoad == "function")
                        {
                            this.OnBeforeLoad(this);
                        }
                        
                        with (__pageNode)
                        {
                            if (!this.Created)
                            {
                                this.ZIndex = (this.ZIndex == null ? parseInt(style.zIndex) : this.ZIndex);
                                
                                var s = innerHTML;
                                innerHTML = "";
                                
                                __scrollNode = __System.Controls.DOM.Append({
                                                                              ID: __controlName + "$Scroll",
                                                                              X: 0,
                                                                              Y: 0,
                                                                              Overflow: "hidden",
                                                                              Parent: __pageNode
                                                                            });
                                
                                __contentNode = __System.Controls.DOM.Append({
                                                                               ID: __controlName + "$Content",
                                                                               X: 0,
                                                                               Y: 0,
                                                                               Html: s,
                                                                               Parent: __scrollNode
                                                                             });
                            }
                            
                            __origSize = { Width: (parseInt(style.width) ? parseInt(style.width) : offsetWidth), Height: (parseInt(style.height) ? parseInt(style.height) : offsetHeight) };
                            
                            style.position = "absolute";
                            style.left = __System.Convert._IsNullToDefault(this.Location.X, style.left);
                            style.top = __System.Convert._IsNullToDefault(this.Location.Y, style.top);
                            style.width = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Width), style.width);
                            style.height = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Height), style.height);
                            style.backgroundColor = __System.Convert._IsNullToDefault(this.BackColor, style.backgroundColor);
                            style.border = (this.BorderStyle != null ? this.BorderStyle + (this.BorderSize != null ? " " + this.BorderSize + "px" : "") + (this.BorderColor != null ? " " + this.BorderColor : "") : style.border);
                            style.zIndex = __System.Convert._IsNullToDefault(this.ZIndex, style.zIndex);
                            
                            if (!this.RightToLeftLayout)
                            {
                                dir = (this.RightToLeft ? "rtl" : "");
                            }
                            
                            tabindex = __System.Convert._IsNullToDefault(this.TabIndex, "");
                            
                            __origLocation = __System.Controls.DOM.Location(__pageNode, true);
                        }
                        
                        if (this.Created)
                        {
                            __scrollNode = __System.Controls.DOM.Append({
                                                                          ID: __controlName + "$Scroll",
                                                                          Parent: __pageNode
                                                                        });
                            
                            __contentNode = __System.Controls.DOM.Append({
                                                                           ID: __controlName + "$Content",
                                                                           Parent: __scrollNode
                                                                         });
                        }
                        
                        ___SwitchTo(null);
                        ___InsertControl(true);
                        
                        ___ScrollTo(Math.min(Math.max(__System.Convert._IsNullToDefault(this.VScrollBar.Minimum, 0), Math.abs(this._ScrollTop())), __System.Convert._IsNullToDefault(this.VScrollBar.Maximum, parseInt(__contentNode.offsetHeight))), __vScrollBar.Name, false, true);
                        
                        var n = 0;
                        
                        if (___IsRightToLeft())
                        {
                            n = Math.min(Math.min(parseInt(__contentNode.offsetWidth) - __System.Convert._IsNullToDefault(this.HScrollBar.Maximum, 0), Math.abs(this._ScrollLeft())), parseInt(__contentNode.offsetWidth) - __System.Convert._IsNullToDefault(this.HScrollBar.Minimum, 0));
                        }
                        else
                        {
                            n = Math.min(Math.max(__System.Convert._IsNullToDefault(this.HScrollBar.Minimum, 0), Math.abs(this._ScrollLeft())), __System.Convert._IsNullToDefault(this.HScrollBar.Maximum, parseInt(__contentNode.offsetWidth)));
                        }
                        
                        ___ScrollTo(n, __hScrollBar.Name, false, true);
                        
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
        FocusOut: function(/*Event*/ evt, /*Boolean*/ bypassMonitor, /*Boolean*/ capturedEvent)
        {
            // summary:
            //   Page event handler for focusout.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //   capturedEvent (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                evt = (evt != null ? evt : event);
                
                if (evt != null && evt.toElement != null)
                {
                    if (__visible)
                    {
                        if (capturedEvent)
                        {
                            if (___TryEventFocus())
                            {
                                if (typeof __this.OnGotFocus == "function")
                                {
                                    __this.OnGotFocus(__this, evt);
                                }
                            }
                        }
                        else
                        {
                            var n = __System.Controls.DOM.IsParentElement(evt.toElement, __pageNode);
                            
                            if (n != -1)
                            {
                                return n;
                            }
                            else
                            {
                                ___RemoveEventFocus();
                                
                                if (typeof __this.OnLostFocus == "function")
                                {
                                    __this.OnLostFocus(__this, evt);
                                }
                            }
                        }
                    }
                }
            }
        },
        MouseMove: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for mousemove.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseMove) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (__shaftActive)
                    {
                        __shaftLocation = __System.Controls.DOM.ConvertPoint(evt);
                    }
                    
                    ___ProcessDrag(evt);
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
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseUp) == __this))
                {
                    evt = (evt != null ? evt : event);
                     
                    if (__shaftActive)
                    {
                        ___EndShaft(__shaftResetTime);
                    }
                    
                    ___EndDrag(evt);
                    
                    __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseMove, __this);
                    ___RemoveEventMouseClick(__this);
                }
            }
        },
        MouseWheel: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for mousewheel.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseWheel) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (__this.VerticalScrollBar && !__vScrollBar.Disabled)
                    {
                        var b = ___ScrollByDirection(__this.MouseWheel, false, __vScrollBar.Name, (evt.wheelDelta > 0 ? -1 : 1));
                        
                        if (b)
                        {
                            __System.Controls.DOM.CancelEvent(evt);
                        }
                    }
                    
                    if (typeof __this.OnMouseWheel == "function")
                    {
                        __this.OnMouseWheel(__this, evt);
                    }
                }
            }
        }
    }
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);
    
    __System.Controls.Event.Add(this, __System.Controls.EventType.FocusOut);
}

if (typeof ScrollBar == "undefined")
{
    ScrollBar = __System.Controls.UI.ScrollBar;
}

__System.Import("System.Controls.UI.ScrollBar", true);
