////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.DOM");
__System.Import("System.Controls.Event");
__System.Import("System.Threading.Monitor");

__System.Controls.UI.CrossFade = function(/*String*/ resource)
{
    var __pageName = "CrossFade";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __backgroundNode = null;    
    var __curOpacity = null;
    var __curState = null;
    var __fadeDirection = null;
    var __fadeTimer = null;
    var __listener = null;
    var __origPosition = null;
    var __regionVisible = false;
    var __regionEntered = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
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
    this.BackgroundImage = null;
    this.BackgroundImageRepeat = null;
    this.BackgroundImageLayout = null;
    this.BypassPhase = null;
    this.Cursor = "default";
    this.Created = false;
    this.Increment = 5;
    this.Height = null;
    this.HoldMouseDown = true;
    this.Image = null;
    this.Inherit = false;
    this.Location = { X: null, Y: null };
    this.Minimum = 0;
    this.Maximum = 100;
    this.MousePosition = { X: null, Y: null };
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnClick = null;
    this.OnMouseDown = null;
    this.OnMouseUp = null;
    this.OnMouseEnter = null;
    this.OnMouseHover = null;
    this.OnMouseLeave = null;
    this.OnMove = null;
    this.PageID = null;
    this.RegionPageID = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.RightToLeft = false;
    this.ShowNonFocus = true;
    this.ShowPressed = true;
    this.ShowRegion = true;
    this.Speed = 10;
    this.TabIndex = null;
    this.Tag = null;
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
                x = x.X;
                y = x.Y;
                width = x.Width;
                height = x.Height;
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
            
            __this.Size.set(width, height);
            
            if (this.Created && (x != xPos || y != yPos))
            {
                with (__pageNode.style)
                {
                    if (__this.Location.X != null || __this.Location.Y != null)
                    {
                        position = "absolute";
                    }
                    
                    left = __System.Convert._IsNullToDefault(__this.Location.X, left);
                    top = __System.Convert._IsNullToDefault(__this.Location.Y, top);
                }
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
        set: function(/*Size|Integer*/ size0, /*Integer*/ size1)
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
                with (__pageNode.style)
                {
                    width = __System.Convert._IsNullToDefault(__this.Width, width);
                    height = __System.Convert._IsNullToDefault(__this.Height, height);
                }
            }
        }
    }
    
    function ___BeginFade(/*Integer*/ state)
    {
        // summary:
        //   Tests for valid fade state changes and then updates
        //   the images based on the fade direction.
        //
        // arguments:
        //   state (required)
        //
        // returns: Nothing
        
        if (state == __curState)
        {
            return;
        }
        else if (!___IsValidState(__curState, state))
        {
            __this.SetImage(state, true);
            ___Reset(state);
            
            return;
        }
        
        clearTimeout(__fadeTimer);
        
        var curState = __curState;
        __curState = state;
        
        __fadeDirection = (curState < state ? 1 : -1);
        
        __this.SetImage((__fadeDirection == 1 ? curState : state), true);
        __this.SetImage((__fadeDirection == 1 ? state : curState), true, true);
        ___SetOpacity((__fadeDirection == 1 ? __this.Minimum : __this.Maximum));
        
        __this._ProcessFade();
    }
    
    function ___ControlNode(/*Boolean*/ useBgNode)
    {
        // summary:
        //   Is used to return the control event node.  The
        //   background node can be selected also.
        //
        // arguments:
        //  useBgNode (optional)
        //
        // returns: Node
        
        return (useBgNode ? __backgroundNode : __pageNode);
    }
    
    function ___EndFade(/*Integer*/ state)
    {
        // summary:
        //   Updates the control to display the fade state chosen
        //   during the initilization.
        //
        // arguments:
        //   state (required)
        //
        // returns: Nothing
        
        if (state != null)
        {
            __this.SetImage(state, true);
        }
        
        ___Reset(state);
    }
    
    function ___IsValidState(/*Integer*/ begin, /*Integer*/ end)
    {
        // summary:
        //   Tests a comma delimited string for numbered values
        //   which specify fade states which should be skipped.
        //
        // arguments:
        //   begin (required)
        //   end (required)
        //
        // returns: Boolean
        
        if (__this.BypassPhase == null)
        {
            return true;
        }
        else if (typeof __this.BypassPhase == "boolean")
        {
            return !__this.BypassPhase;
        }
        
        var o = __this.BypassPhase.split(",");
        
        for (var i = 0; i < o.length; i++)
        {
            var idx = o[i].split("-");
            
            if (idx.length == 2 && begin == idx[0] && end == idx[1])
            {
                return false;
            }
        }
        
        return true;
    }
    
    function ___Reset(/*Integer*/ state)
    {
        // summary:
        //   Finalizes or cancels the fade state for the control
        //   by clearing the interval timer and making the fade
        //   layer Invisible.
        //
        // arguments:
        //   state (required)
        //
        // returns: Nothing
        
        __fadeDirection = null;
        
        clearTimeout(__fadeTimer);
        __fadeTimer = null;
        
        ___SetOpacity(__this.Minimum);
        
        if (state != null)
        {
            __curState = state;
        }
    }
    
    function ___SetOpacity(/*Integer*/ opacity)
    {
        // summary:
        //   Updates the current opacity of the control.
        //
        // arguments:
        //   opacity (required)
        //
        // returns: Nothing
        
        __System.Controls.DOM.SetOpacity(___ControlNode(), opacity);
        __curOpacity = opacity;
    }
    
    this._MinLength = function(/*Boolean*/ bypassRegion)
    {
        // summary:
        //   Figures out the current Rest state for the control
        //   and also when region groups are used.
        //
        // arguments:
        //   bypassRegion (optional)
        //
        // returns: Integer
        
        if (this.Parent != null && this.Parent.RegionPageID != null && (!this.Parent.ShowRegion || this.Inherit))
        {
            return this.Parent._MinLength(bypassRegion);
        }
        else
        {
            var n = 1;
            
            if (this.RegionPageID != null && !this.ShowRegion && !__regionVisible)
            {
                n = -1;
            }
            else if (this.ShowNonFocus)
            {
                if (bypassRegion)
                {
                    n = 0;
                }
                else if (this.Parent == null)
                {
                    if (this.RegionPageID == null || (this.RegionPageID != null && !__regionVisible))
                    {
                        n = 0;
                    }
                }
                else
                {
                    if (this.Parent.RegionPageID == null || !this.Inherit)
                    {
                        n = 0;
                    }
                }
            }
            
            return n;
        }
    }
    
    this._ProcessFade = function()
    {
        // summary:
        //   Increases or decreases the opacity of the control
        //   until an upper or lower bound is reached.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        var y;
        var b = false;
        
        if (__fadeDirection == 1)
        {
            y = Math.min(__curOpacity + this.Increment, this.Maximum);
            b = (y == this.Maximum);
        }
        else if (__fadeDirection == -1)
        {
            y = Math.max(this.Minimum, __curOpacity - this.Increment);
            b = (y == this.Minimum);
        }
        
        ___SetOpacity(y);
        
        if (!b)
        {
            __fadeTimer = setTimeout(__controlName + "._ProcessFade()", this.Speed);
        }
        else
        {
            ___EndFade(__curState);
        }
    }
    
    this.Add = function(/*Object*/ control)
    {
        // summary:
        //   User procedure to add a control to the Listener.
        //
        // arguments:
        //   control (required)
        //
        // returns: Nothing
        
        if (__listener == null)
        {
            __System.Import("System.Controls.UI.CrossFade.Listener");
            
            __listener = new __System.Controls.UI.CrossFade.Listener(__this);
            
            with (__listener)
            {
                Inherit("ShowNonFocus");
                Inherit("ShowPressed");
                Inherit("HoldMouseDown");
                Inherit("BypassPhase");
                Inherit("Speed");
                Inherit("Increment");
                Inherit("Minimum");
                Inherit("Maximum");
            }
        }
        
        if (control != null)
        {
            var b = __listener.Add(control);

            if (b)
            {
                if (this.RegionPageID != null && !this.ShowRegion)
                {
                    control.Show(__regionVisible);
                }
                
                __listener.Update(control);
                
                if (control.Inherit && __curState == this._MinLength())
                {
                    control.SetImage(__curState);
                }
                
                return true;
            }
        }
        
        return false;
    }
    
    this.Remove = function(/*Object*/ control)
    {
        // summary:
        //   User procedure to remove a control from the Listener.
        //
        // arguments:
        //   control (required)
        //
        // returns: Boolean
        
        if (__listener != null)
        {
            return __listener.Remove(control);
        }
    }
    
    this.SetImage = function(/*Integer*/ state, /*Boolean*/ bypassFade, /*Boolean*/ useControl, /*Boolean*/ useListener)
    {
        // summary:
        //   Processes the image states and visibility for
        //   the control.
        //
        // arguments:
        //   state (required)
        //   bypassFade (optional)
        //   useControl (optional)
        //   useListener (optional)
        //
        // returns: Nothing
        
        if (state >= -1 && state < __resources[this.Image].State.length)
        {
            if (useListener && __listener != null)
            {
                __listener.Eval("SetImage", state);
            }
            
            if (!bypassFade)
            {
                ___BeginFade(state);
            }
            else
            {
                var b = (useControl || state > -1);
                
                if (!this.ShowNonFocus && state == 0)
                {
                    state = 1;
                }
                
                __System.Controls.DOM.SetVisibility(___ControlNode(!useControl), (useControl ? (state > -1) : b));
                ___ControlNode(!useControl).src = __resources[this.Image].Build(state);
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
        
        __visible = (isVisible == null || isVisible);
        
        var b = __visible;
        
        if (__curState == -1)
        {
            b = false;
        }
        
        __System.Controls.DOM.SetVisibility(___ControlNode(true), b);
        __System.Controls.DOM.SetVisibility(___ControlNode(), b);
        
        this.Visible = __visible;
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
                __pageNode = document.getElementById(this.PageID);
                
                if (__pageNode == null)
                {
                    if (this.PageID == null)
                    {
                        this.PageID = __System.Controls.DOM.FindUnused(__controlName);
                    }
                    
                    __pageNode = __System.Controls.DOM.Append({
                                                                ID: this.PageID,
                                                                Visibility: false
                                                              });
                }
                
                if (typeof this.OnBeforeLoad == "function")
                {
                    this.OnBeforeLoad(this);
                }        
                
                with (__pageNode)
                {
                    type = "IMG";
                    
                    if (!this.Created)
                    {
                        __origPosition = style.position;
                        
                        this.ZIndex = (this.ZIndex == null ? parseInt(style.zIndex) : this.ZIndex);
                    }
                    else
                    {
                        style.position = __origPosition;
                    }
                    
                    if (this.Location.X != null || this.Location.Y != null)
                    {
                        style.position = "absolute";
                    }
                    
                    style.left = __System.Convert._IsNullToDefault(this.Location.X, "");
                    style.top = __System.Convert._IsNullToDefault(this.Location.Y, "");
                    style.width = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Width), "");
                    style.height = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Height), "");
                    style.zIndex = __System.Convert._IsNullToDefault(this.ZIndex, "");
                    style.cursor = __System.Convert._IsNullToDefault(this.Cursor, "");
                    
                    dir = (this.RightToLeft ? "rtl" : "");
                    tabindex = __System.Convert._IsNullToDefault(this.TabIndex, "");
                    
                    onmove = function()
                    {
                        if (typeof __this.OnMove == "function")
                        {
                            __this.OnMove(__this, event);
                        }
                    }
                    
                    onmouseenter = function()
                    {
                        var hasLock = (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this);
                        
                        if (!__this.HoldMouseDown || __System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) || hasLock)
                        {
                            var o = (__this.Parent != null && __this.Parent.RegionPageID != null ? __this.Parent : (__this.RegionPageID != null ? __this : null));
                            
                            if (o != null && !hasLock)
                            {
                                o.SetImage(1, null, null, true);
                            }
                            
                            __this.SetImage((__this.ShowPressed && hasLock ? 3 : 2));
                        }
                        
                        if (typeof __this.OnMouseEnter == "function")
                        {
                            __this.OnMouseEnter(__this, event);
                        }                    
                    }
                    
                    onmousemove = function()
                    {
                        __this.MousePosition = __System.Controls.DOM.ConvertPoint(event);
                        
                        if (typeof __this.OnMouseHover == "function")
                        {
                            __this.OnMouseHover(__this, event);
                        }
                    }
                    
                    onmouseleave = function()
                    {
                        __this.MousePosition = { X: null, Y: null };
                        
                        __this.SetImage((__this.HoldMouseDown && __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this ? 2 : __this._MinLength()));
                        
                        if (typeof __this.OnMouseLeave == "function")
                        {
                            __this.OnMouseLeave(__this, event);
                        }
                    }
                    
                    onmousedown = function()
                    {
                        if (___TryEventMouseClick(__this))
                        {
                            if (__this.ShowPressed)
                            {
                                __this.SetImage(3);
                            }
                        }
                        
                        if (typeof __this.OnMouseDown == "function")
                        {
                            __this.OnMouseDown(__this, event);
                        }
                    }
                    
                    onmouseup = function()
                    {
                        __this.SetImage(2);
                        
                        if (typeof __this.OnMouseUp == "function")
                        {
                            __this.OnMouseUp(__this, event);
                        }
                    }
                    
                    onclick = function()
                    {
                        if (typeof __this.OnClick == "function")
                        {
                            __this.OnClick(__this, event);
                        }
                    }
                }
                
                if (this.Image == null)
                {
                    this.Image = __resources[__System.ResourceKeyIndex][0];
                }
                
                ___Reset(this._MinLength());
                
                var p = __System.Controls.DOM.Bounds(__pageNode, __pageNode.parentElement);
                
                __backgroundNode = __System.Controls.DOM.Append({
                                                                  ID: this.PageID + "$Background",
                                                                  Type: __pageNode.tagName,
                                                                  X: p.X,
                                                                  Y: p.Y,
                                                                  Width: p.Width,
                                                                  Height: p.Height,
                                                                  BackColor: (this.BackColor != null ? this.BackColor : ""),
                                                                  ZIndex: this.ZIndex - 1,
                                                                  Parent: __pageNode.parentElement
                                                                });
                
                with (__backgroundNode.style)
                {
                    backgroundImage = __System.Convert._IsNullToDefault(this.BackgroundImage, "");
                    backgroundPosition = __System.Convert._IsNullToDefault(this.BackgroundImageLayout, "");
                    backgroundRepeat = __System.Convert._IsNullToDefault(this.BackgroundImageRepeat, "");
                }
                
                this.SetImage(this._MinLength(), true);
                
                __System.Controls.Event.Remove(this, __System.Controls.EventType.MouseUp | __System.Controls.EventType.MouseMove);
                
                if (this.RegionPageID != null)
                {
                    __System.Controls.Event.Add(this, __System.Controls.EventType.MouseUp | __System.Controls.EventType.MouseMove);
                }
                else if (this.HoldMouseDown)
                {
                    __System.Controls.Event.Add(this, __System.Controls.EventType.MouseMove);
                }
                
                if (__listener != null && __listener.Count > 0)
                {
                    __listener.UpdateAll();
                    __listener.Eval("Load");
                }
                
                this.Created = true;
                
                this.Show();
                
                if (typeof this.OnAfterLoad == "function")
                {
                    this.OnAfterLoad(this);
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
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                evt = (evt != null ? evt : event);
                
                if (__this.RegionPageID != null)
                {
                    var b = __System.Controls.DOM.IsElementWithin(__this.RegionPageID, __System.Controls.DOM.ConvertPoint(evt));
                    
                    if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
                    {
                        __regionEntered = null;
                        
                        if (b != __regionVisible)
                        {
                            __regionVisible = b;
                            __this.SetImage(__this._MinLength(true), null, null, true);
                        }
                    }
                    else
                    {
                        __regionEntered = b;
                    }
                }
                
                if (__curState > __this._MinLength() && !__System.Controls.DOM.IsElementWithin(__pageNode, __System.Controls.DOM.ConvertPoint(evt)) && __System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) != __this)
                {
                    __this.SetImage(__this._MinLength());
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
                evt = (evt != null ? evt : event);
                
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.MouseUp) == __this))
                {
                    var b = false;
                    
                    if (__regionEntered != null)
                    {
                        if (__regionEntered != __regionVisible)
                        {
                            __regionVisible = __regionEntered;
                            __this.SetImage(__this._MinLength(true), null, null, true);
                            
                            b = true;
                        }
                        
                        __regionEntered = null;
                    }
                    
                    if (!b && !__System.Controls.DOM.IsElementWithin(__pageNode, __System.Controls.DOM.ConvertPoint(evt)))
                    {
                        __this.SetImage(__this._MinLength());
                    }
                    
                    ___RemoveEventMouseClick(__this);
                }
            }
        }
    }
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);
}

if (typeof CrossFade == "undefined")
{
    CrossFade = __System.Controls.UI.CrossFade;
}

__System.Import("System.Controls.UI.CrossFade", true);
