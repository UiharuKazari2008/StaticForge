////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.ScrollBar");
__System.Import("System.Controls.UI.Components.Enumerations");

__System.Controls.UI.ListBox = function(/*String*/ resource)
{
    var __pageName = "ListBox";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __contentNode = null;
    var __bypassFocusEnter = false;
    var __curEvent = null;
    var __focusIndex = -1;
    var __hScrollBarHeight = null;
    var __hasScrolled = false;
    var __innerWidth = null;
    var __innerHeight = null;
    var __innerOffset = null;
    var __itemWidth = null;
    var __itemHeight = null;
    var __keyboardSpeed = 50;
    var __multiSelect = false;
    var __origPosition = null;
    var __outerHeight = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __scrollable = false;
    var __scrollHeight = null;
    var __timer = null;
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
            __resource.Args["ScrollBar"] = (resource["ScrollBar"] != null ? resource["ScrollBar"] : null);
        }
    }
    
    this.BackColor = null;
    this.BackgroundImage = null;
    this.BackgroundImageRepeat = null;
    this.BackgroundImageLayout = null;
    this.BorderColor = "#000000";
    this.BorderSize = 1;
    this.BorderStyle = "solid";
    this.Bottom = 0;
    this.ContainsFocus = false;
    this.Created = false;
    this.Cursor = "default";
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.HorizontalExtent = null;
    this.HorizontalScrollbar = false;
    this.IntegralHeight = false;
    this.Items = new __System.Collections.Generic.List(),
    this.Left = 0;
    this.Location = { X: null, Y: null };
    this.MousePosition = { X: null, Y: null };
    this.MouseWheel = null;
    this.Name = null;
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnClick = null;
    this.OnItemMouseEnter = null;
    this.OnItemMouseHover = null;
    this.OnItemMouseLeave = null;
    this.OnKeyDown = null;
    this.OnKeyPress = null;
    this.OnKeyUp = null;
    this.OnGotFocus = null;
    this.OnLostFocus = null;
    this.OnMouseDown = null;
    this.OnMouseUp = null;
    this.OnMouseEnter = null;
    this.OnMouseHover = null;
    this.OnMouseLeave = null;
    this.OnMouseWheel = null;
    this.OnMove = null;
    this.OnSizeChanged = null;
    this.PageID = null;
    this.Parent = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.ScrollAlwaysVisible = false;
    this.SelectedIndex = -1;
    this.SelectedIndices = new __System.Controls.UI.ListBox.ObjectCollection();
    this.SelectedItem = null;
    this.SelectedItems = new __System.Controls.UI.ListBox.ObjectCollection();
    this.SelectedValue = null;
    this.SelectionMode = __System.Controls.UI.Components.SelectionMode.MultiExtended;
    this.Sorted = false;
    this.TabIndex = null;
    this.Tag = null;
    this.Text = null;
    this.Top = 0;
    this.TopIndex = null;
    this.ValueMember = null;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
    
    this.ScrollBar = new __System.Controls.UI.ScrollBar(__resource.Args["ScrollBar"]);
    this.ScrollBar.Parent = this;
    
    if (!__resource.Args["ScrollBar"])
    {
        __resource.Children.push(this.ScrollBar);
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
            
            var b = __this.Size.set(width, height);
            
            if (__this.Created && (b || x != xPos || y != yPos))
            {
                if (__scrollable)
                {
                    __this.ScrollBar.Bounds.set(__this.Bounds.get());
                }
                else
                {
                    with (__pageNode.style)
                    {
                        if (__this.Location.X != null || __this.Location.Y != null)
                        {
                            position = "absolute";
                        }
                        
                        left = __System.Convert._IsNullToDefault(__this.Location.X, left);
                        top = __System.Convert._IsNullToDefault(__this.Location.Y, top);
                        
                        if (b)
                        {
                            width = __System.Convert._IsNullToDefault(__this.Width, width);
                            height = __System.Convert._IsNullToDefault(__this.Height, height);
                        }
                    }
                }
                
                if (b)
                {
                    if (typeof __this.OnSizeChanged == "function")
                    {
                        __this.OnSizeChanged(__this.Size.get());
                    }
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
                    if (__scrollable)
                    {
                        __this.ScrollBar.Size.set(__this.Width, __this.Height);
                    }
                    else
                    {
                        with (__pageNode.style)
                        {
                            width = __System.Convert._IsNullToDefault(__this.Width, width);
                            height = __System.Convert._IsNullToDefault(__this.Height, height);
                        }
                    }
                    
                    if (typeof __this.OnSizeChanged == "function")
                    {
                        __this.OnSizeChanged(__this.Size.get());
                    }
                }
                else
                {
                    return true;
                }
            }
        }
    }
    
    function ___BlurElement(/*String*/ element)
    {
        var itemNode = document.getElementById(element);
        
        if (itemNode != null)
        {
            itemNode.blur();
        }
    }
    
    function ___ClickItem(/*Integer*/ index, /*Event*/ _evt)
    {
        if (_evt != null)
        {
            var o = __this.SelectedIndices.GetEnumerator();
            
            while (o.MoveNext())
            {
                ___Select(__this.SelectedIndices[o.Current], false, true);
            }
            
            switch (__this.SelectionMode)
            {
                case __System.Controls.UI.Components.SelectionMode.None:
                    return;
                case __System.Controls.UI.Components.SelectionMode.MultiExtended:
                    __multiSelect = true;
                    break;
                case __System.Controls.UI.Components.SelectionMode.MultiSimple:
                    __multiSelect = true;
                    break;
                case __System.Controls.UI.Components.SelectionMode.One:
                    __this.SelectedIndices.Clear();
                    __multiSelect = false;
                    break;
            }
            
            var b = true;
            
            if (__multiSelect && __this.SelectedIndices.Count > 0)
            {
                if (_evt.shiftKey || _evt.ctrlKey)
                {
                    var n = __this.SelectedIndices[0];
                    
                    if (_evt.shiftKey)
                    {
                        if (n != index)
                        {
                            __this.SelectedIndices.Clear();
                            
                            var j = (n > index ? -1 : 1);
                            
                            for (var i = n; i != index; i += j)
                            {
                                __this.SelectedIndices.Add(i);
                            }
                        }
                    }
                    else if (_evt.ctrlKey)
                    {
                        var n = __this.SelectedIndices.IndexOf(index);
                        
                        if (n != -1)
                        {
                            __this.SelectedIndices.Remove(n);
                            b = false;
                        }
                    }
                }
                else
                {
                    __this.SelectedIndices.Clear();
                }
            }
            
            if (b)
            {
                __this.SelectedIndices.Add(index);
            }
            
            __focusIndex = index;
            
            ___Properties(index);
        }
    }
    
    function ___FocusItem(/*Integer*/ index)
    {
        __focusIndex = index;
        document.getElementById(__controlName + "$Item$Anchor$" + index).focus();
    }
    
    function ___InsertControl()
    {
        __itemHeight = __resources["SelectedItemBg"].Height;
        
        __outerHeight = __this.Height;
        
        if (__this.IntegralHeight && __this.Height != null)
        {
            __outerHeight = (Math.ceil(__this.Height / __itemHeight) * __itemHeight) + __this.Top + __this.Bottom;
        }
        
        __innerWidth = 0;
        __innerOffset = 0;
        __innerHeight = __outerHeight = (__this.Height == null ? (__this.Items.Count * __itemHeight) + __this.Top + __this.Bottom : __outerHeight);
        __scrollHeight = (__itemHeight * __this.Items.Count) + __this.Top + __this.Bottom;
        
        if (__this.BorderStyle != null && __this.BorderSize > 0)
        {
            if (__this.Height == null || (__this.IntegralHeight && __this.Height != null))
            {
                __outerHeight += __this.BorderSize * 2;
            }
            else
            {
                __innerHeight -= __this.BorderSize * 2;
            }
            
            __innerOffset -= __this.BorderSize * 2;
        }
        
        __innerWidth = (__this.Width != null ? __this.Width + __innerOffset : 0);
        
        var scrollBarSize = (__this.ScrollAlwaysVisible || __scrollHeight > __innerHeight ? __this.ScrollBar.VScrollBar.Width : 0);
        var itemOffset = scrollBarSize + __this.Left + __this.Right + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width;
        
        if (__this.Sorted)
        {
            __this.Items.Sort(new function()
            {
                __this.Compare = function(obj0, obj1)
                {
                    if (obj0 != null && obj1 != null)
                    {
                        obj0 = ___ValueMember(obj0).toString();
                        obj1 = ___ValueMember(obj1).toString();
                        
                        if (obj0.length != obj1.length)
                        {
                            if (obj0.length < obj1.length)
                            {
                                return 1;
                            }
                        }
                        else
                        {
                            if (obj0 == obj1)
                            {
                                return 0;
                            }
                            else if (obj0 < obj1)
                            {
                                return 1;
                            }
                        }
                    }
                    
                    return -1;
                }
            });
        }
        
        var s = '<table id="' + __controlName + '$ListItems" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="' + (__innerWidth > 0 ? "width:" + __innerWidth + ";" : "") + 'height:' + __scrollHeight + 'px">' +
                '<tr>' +
                '<td>' +
                '<ul unselectable="on" style="margin:0px">';
        
        var o = __this.Items.GetEnumerator();
        
        while (o.MoveNext())
        {
            s += '<li id="' + __controlName + '$Item$' + o.Current + '" title="' + __this.Items[o.Current] + '" unselectable="on" Index="' + o.Current + '" style="position:absolute;top:' + (__this.Top + (o.Current * __itemHeight)) + 'px;left:' + __this.Left + 'px;height:' + __itemHeight + 'px;margin:0px">' +
                 '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on">' +
                 '<tr>' +
                 '<td id="' + __controlName + '$Item$Left$' + o.Current + '" unselectable="on" style="width:' + __resources["SelectedItemLeft"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '<td' + (__this.RightToLeft ? ' dir="rtl"' : '') + ' id="' + __controlName + '$Item$Background$' + o.Current + '" unselectable="on" style="height:' + __itemHeight + 'px" nowrap><h2 unselectable="on" style="font-weight:normal;margin:0px"><a id="' + __controlName + '$Item$Anchor$' + o.Current + '" href="javascript:void(0)" unselectable="on" Index="' + o.Current + '" style="' + (__innerWidth > 0 ? "width:" + (__innerWidth - itemOffset) + "px;" : "") + (__this.ForeColor != null ? "color:" + __this.ForeColor + ";" : "") + 'text-decoration:none;text-overflow:ellipsis;white-space:nowrap;overflow:hidden' + (__this.Cursor != null ? ';cursor:' + __this.Cursor : '') + '">' + ___ValueMember(__this.Items[o.Current]) + '</a></h2></td>' +
                 '<td id="' + __controlName + '$Item$Right$' + o.Current + '" unselectable="on" style="width:' + __resources["SelectedItemRight"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '</tr>' +
                 '</table>' +
                 '</li>';
        }
        
        s += '</ul>' +
             '</td>' +
             '</tr>' +
             '</table>';
        
        with (__pageNode)
        {
            style.height = __outerHeight;
            
            innerHTML = s;
        }
        
        if (__this.Font != null)
        {
            o.Reset();
            
            while (o.MoveNext())
            {
                __System.Controls.DOM.ApplyFontStyle(__controlName + "$Item$Anchor$" + o.Current, __this.Font);
            }
        }
        
        if (__this.Width == null)
        {
            for (var i = 0; i < __this.Items.Count; i++)
            {
                __innerWidth = Math.max(__innerWidth, document.getElementById(__controlName + "$Item$Anchor$" + i).offsetWidth);
            }
            
            for (var i = 0; i < __this.Items.Count; i++)
            {
                document.getElementById(__controlName + "$Item$Anchor$" + i).style.width = __innerWidth;
            }
            
            __innerWidth += itemOffset;
            __pageNode.style.width = __innerWidth + __innerOffset;
        }
        
        var bHScroll = __this.HorizontalScrollbar;
        __hScrollBarHeight = 0;
        
        if (__this.HorizontalScrollbar)
        {
            var w = __innerWidth - itemOffset;
            var n = 0;
            
            for (var i = 0; i < __this.Items.Count; i++)
            {
                with (document.getElementById(__controlName + "$Item$Anchor$" + i))
                {
                    style.width = "";
                    n = Math.max(n, document.getElementById(__controlName + "$Item$Anchor$" + i).offsetWidth);
                }
            }
            
            if (n > w)
            {
                if (__this.HorizontalExtent != null && __this.HorizontalExtent <= n - w)
                {
                    w += __this.HorizontalExtent;
                }
                else
                {
                    w = n;
                }
                
                __hScrollBarHeight = __this.ScrollBar.HScrollBar.Height;
                
                if (__this.IntegralHeight)
                {
                    __innerHeight += __hScrollBarHeight;
                    __pageNode.style.height = __outerHeight + __hScrollBarHeight;
                }
                
                __innerWidth = w + __this.Left + __this.Right + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width;
                
                document.getElementById(__controlName + "$ListItems").style.width = __innerWidth;
            }
            else
            {
                bHScroll = false;
            }
            
            for (var i = 0; i < __this.Items.Count; i++)
            {
                document.getElementById(__controlName + "$Item$Anchor$" + i).style.width = w;
            }
        }
        
        __itemWidth = __innerWidth - itemOffset + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width;
        __scrollable = (scrollBarSize > 0 || bHScroll);
        
        if (__scrollable)
        {
            __this.ScrollBar.PageID = __this.PageID;
            __this.ScrollBar.RightToLeftLayout = __this.RightToLeft;
            __this.ScrollBar.Width = parseInt(__pageNode.style.width);
            __this.ScrollBar.Height = __outerHeight + __hScrollBarHeight;
            __this.ScrollBar.BorderColor = __this.BorderColor;
            __this.ScrollBar.BorderSize = __this.BorderSize;
            __this.ScrollBar.BorderStyle = __this.BorderStyle;
            __this.ScrollBar.VerticalScrollBar = (scrollBarSize > 0);
            __this.ScrollBar.HorizontalScrollBar = bHScroll;
            __this.ScrollBar.Created = false;
            
            if (__this.MouseWheel == null)
            {
                __this.ScrollBar.MouseWheel = __itemHeight;
            }
            
            __this.ScrollBar.Load();
        }
        else
        {
            __this.ScrollBar.Show(false);
        }
        
        o.Reset();
        
        while (o.MoveNext())
        {
            with (document.getElementById(__controlName + "$Item$" + o.Current))
            {
                onclick = function()
                {
                    __bypassFocusEnter = true;
                    ___ClickItem(parseInt(this.Index), event);
                }
                
                onfocusin = function()
                {
                    if (!__bypassFocusEnter)
                    {
                        if (__scrollable)
                        {
                            ___MoveToItem(parseInt(this.Index), true);
                        }
                        
                        if (__this.SelectionMode == __System.Controls.UI.Components.SelectionMode.One)
                        {
                            ___Select(parseInt(this.Index), true, true);
                        }
                    }
                    
                    __bypassFocusEnter = false;
                }
                
                onfocusout = function()
                {
                    if (__this.SelectionMode == __System.Controls.UI.Components.SelectionMode.One)
                    {
                        ___Select(parseInt(this.Index), false, true);
                    }
                }
                
                if (typeof __this.OnItemMouseEnter == "function")
                {
                    onmouseenter = function()
                    {
                        __this.OnItemMouseEnter(__this, event, parseInt(this.Index));
                    }
                }
                
                if (typeof __this.OnItemMouseHover == "function")
                {
                    onmousemove = function()
                    {
                        __this.OnItemMouseHover(__this, event, parseInt(this.Index));
                    }
                }
                
                if (typeof __this.OnItemMouseLeave == "function")
                {
                    onmouseleave = function()
                    {
                        __this.OnItemMouseLeave(__this, event, parseInt(this.Index));
                    }
                }
            }
        }
    }
    
    function ___MoveToItem(/*Integer*/ index)
    {
        var y = 0;
        
        var y0 = Math.abs(__this.ScrollBar._ScrollTop()) - (__focusIndex < index ? __this.Top : 0);
        var y1 = (index * __itemHeight) + __hScrollBarHeight;
        var y2 = __this.Top + __this.Bottom;
        
        if ((y1 > y0 && y1 < (Math.min(y0 + __innerHeight, __scrollHeight) - y2)) || y1 < __innerHeight - y2)
        {
            if (y1 > __innerHeight - y2 || index > __focusIndex)
            {
                y = -1;
            }
        }
        else
        {
            y = y1;
            
            if (index >= __focusIndex)
            {
                y += __itemHeight + y2 - __innerHeight;
            }
            else
            {
                y -= __hScrollBarHeight;
            }
        }
        
        if (y != -1)
        {
            __this.ScrollBar._ScrollTo(y, true);
        }
        
        __focusIndex = index;
    }
    
    function ___Properties(/*Integer*/ index)
    {
        var sindex = __this.SelectedIndex;
        var item = __this.SelectedItem;
        var value = __this.SelectedValue;
                
        __this.SelectedItems.Clear();
        
        var o = __this.SelectedIndices.GetEnumerator();
        
        while (o.MoveNext())
        {
            __this.SelectedItems.Add(__this.Items[__this.SelectedIndices[o.Current]]);
            ___Select(__this.SelectedIndices[o.Current], true, true);
        }
        
        if (index != null)
        {
            __this.SelectedIndex = index;
        }
        
        if (__this.SelectedIndices.Count > 0)
        {
            __this.SelectedItem = __this.Items[__this.SelectedIndex];
            __this.SelectedValue = ___ValueMember(__this.SelectedItem);
        }
        else
        {
            __this.SelectedItem = null;
            __this.SelectedValue = null;
        }
        
        if (__this.SelectedIndex != sindex)
        {
            if (typeof __this.OnSelectedIndexChanged == "function")
            {
                __this.OnSelectedIndexChanged(__this);
            }
        }
        
        if (__this.SelectedItem != item)
        {
            if (typeof __this.OnSelectedItemChanged == "function")
            {
                __this.OnSelectedItemChanged(__this);
            }
        }
        
        if (__this.SelectedValue != value)
        {
            if (typeof __this.OnSelectedValueChanged == "function")
            {
                __this.OnSelectedValueChanged(__this);
            }
        }
    }
    
    function ___RemoveEventFocus()
    {
        __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseWheel, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyPress, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyDown, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyUp, __this);
        
        __this.ContainsFocus = false;
    }
    
    function ___Select(/*Integer*/ index, /*Boolean*/ selectItem, /*Boolean*/ bypassTimer, /*Boolean*/ bypassFocus)
    {
        if (index >= 0 && index < __this.Items.Count)
        {
            if (__timer == null || bypassTimer)
            {
                document.getElementById(__controlName + "$Item$Background$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemBg"].Build() : "") + ")";
                document.getElementById(__controlName + "$Item$Left$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemLeft"].Build() : "") + ")";
                document.getElementById(__controlName + "$Item$Right$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemRight"].Build() : "") + ")";
                
                if (!bypassFocus && selectItem && index == __focusIndex)
                {
                    ___FocusItem(index);
                }
            }
        }
    }
    
    function ___TryEventFocus()
    {
        if (__System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyPress, __this) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyDown, __this) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyUp, __this))
        {
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
    
    function ___ValueMember(/*Object*/ obj)
    {
        var o = obj;
        
        if (obj != null && __this.ValueMember != null)
        {
            if (obj[__this.ValueMember] != null)
            {
                o = obj[__this.ValueMember];
            }
        }
        
        return o;
    }
    
    this._MoveToItemByDirection = function(/*Integer*/ direction, /*Boolean*/ useTimerRepeat)
    {
        var index = Math.min(Math.max(0, __focusIndex + direction), this.Items.Count - 1);
        
        if (index != __focusIndex)
        {
            ___MoveToItem(index);
            
            __focusIndex = index;
            __bypassFocusEnter = true;
            
            if (__curEvent.ctrlKey)
            {
                ___FocusItem(index);
            }
            else
            {
                ___ClickItem(index, __curEvent);
            }
        }
        
        if (useTimerRepeat)
        {
            __timer = setTimeout(__controlName + "._MoveToItemByDirection(" + direction + ", true)", __keyboardSpeed);
        }
        
        __hasScrolled = true;
    }
    
    this._SetFocus = function(/*Integer*/ index)
    {
        __focusIndex = index;
    }
    
    this.ClearSelected = function()
    {
        var o = this.SelectedIndices.GetEnumerator();
        
        while (o.MoveNext())
        {
            ___Select(this.SelectedIndices[o.Current], false, true);
        }
        
        this.SelectedIndices.Clear();
        
        ___Properties(-1);
    }
    
    this.FindString = function(/*String*/ search, /*Integer*/ index)
    {
        var n = -1;
        
        if (search != null)
        {
            search = search.toString();
            
            n = this.Items.FindIndex(function(obj)
            {
                if (obj != null)
                {
                    obj = ___ValueMember(obj).toString();
                    return (obj.substring(0, search.length) == search);
                }
                
                return false;
            }, index);
        }
        
        return n;
    }
    
    this.FindStringExact = function(/*String*/ search, /*Integer*/ index)
    {
        var n = -1;
        
        if (search != null)
        {
            search = search.toString();
            
            n = this.Items.FindIndex(function(obj)
            {
                if (obj != null)
                {
                    obj = ___ValueMember(obj).toString();
                    return (obj == search);
                }
                
                return false;
            }, index);
        }
        
        return n;
    }
    
    this.Focus = function()
    {
        if (__visible)
        {
            __pageNode.focus();
        }
    }
    
    this.GetItemHeight = function()
    {
        return __itemHeight;
    }
    
    this.GetItemRectangle = function(/*Integer*/ index)
    {
        var o = { X: null, Y: null, Width: null, Height: null };
       
        if (index >= 0 && index < this.Items.Count)
        {
            o = __System.Controls.DOM.Bounds(__controlName + "$Item$" + index);
        }
        
        return o;
    }
    
    this.GetItemText = function(/*Integer*/ index)
    {
        var s = null;
        
        if (index >= 0 && index < this.Items.Count)
        {
            s = __ValueMember(index);
        }
        
        return s;
    }
    
    this.GetSelected = function(/*Integer*/ index)
    {
        var b = false;
        
        if (index >= 0 && index < this.Items.Count)
        {
            b = (this.SelectedIndices.IndexOf(index) != -1);
        }
        
        return b;
    }
    
    this.IndexFromPoint = function(/*Point*/ point)
    {
        var n = -1;
        
        if (point != null && point.X != null && point.Y != null)
        {
            if (point.X >= this.Left && point.X <= __itemWidth)
            {
                n = Math.floor((point.Y - this.Top) / __itemHeight);
                
                if (n > this.Items.Count - 1)
                {
                    n = -1;
                }
            }
        }
        
        return n;
    }
    
    this.SetBounds = function(/*Integer*/ x, /*Integer*/ y, /*Integer*/ width, /*Integer*/ height)
    {
        this.Bounds.set(x, y, width, height);
    }
    
    this.SetSelected = function(/*Integer*/ index, /*Boolean*/ select)
    {
        if (index != null)
        {        
            var n = this.SelectedIndices.IndexOf(index);
            
            if (select)
            {
                if (n == -1)
                {
                    this.SelectedIndices.Add(index);
                }
            }
            else
            {
                if (n != -1)
                {
                    this.SelectedIndices.Remove(index);
                }
            }
            
            ___Properties((this.SelectedIndices.Count > 0 ? this.SelectedIndices[this.SelectedIndices.Count - 1] : -1));
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
            
            if (__scrollable)
            {
                this.ScrollBar.Show(__visible);
            }
            
            __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            __System.Controls.DOM.SetVisibility(__contentNode, __visible);
            
            if (!__visible)
            {
                ___RemoveEventFocus();
                
                if (__focusIndex != -1)
                {
                    ___BlurElement(__controlName + "$Item$Anchor$" + __focusIndex);
                    __focusIndex = -1;
                }
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
                __pageNode = document.getElementById(this.PageID);
                
                if (__pageNode == null)
                {
                    if (this.PageID == null)
                    {
                        this.PageID = __System.Controls.DOM.FindUnused(__controlName);
                    }
                    
                    __pageNode = __System.Controls.DOM.Append({
                                                                ID: this.PageID,
                                                                Position: "relative",
                                                                Visibility: false
                                                              });
                }
                
                if (typeof this.OnBeforeLoad == "function")
                {
                    this.OnBeforeLoad(this);
                }        
                
                with (__pageNode)
                {
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
                    style.backgroundColor = __System.Convert._IsNullToDefault(this.BackColor, "");
                    style.backgroundImage = "url(" + __System.Convert._IsNullToDefault(this.BackgroundImage, "") + ")";
                    style.backgroundPosition = __System.Convert._IsNullToDefault(this.BackgroundImageLayout, "");
                    style.backgroundRepeat = __System.Convert._IsNullToDefault(this.BackgroundImageRepeat, "");
                    style.border = (this.BorderStyle != null && this.BorderSize > 0 ? this.BorderStyle + " " + this.BorderSize + "px" + (this.BorderColor != null ? " " + this.BorderColor : "") : "");
                    style.zIndex = __System.Convert._IsNullToDefault(this.ZIndex, "");
                    style.cursor = __System.Convert._IsNullToDefault(this.Cursor, "");
                    
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
                        
                        if (typeof __this.OnMouseLeave == "function")
                        {
                            __this.OnMouseLeave(__this, event);
                        }
                    }
                    
                    onmousedown = function()
                    {
                        if (typeof __this.OnMouseDown == "function")
                        {
                            __this.OnMouseDown(__this, event);
                        }
                    }
                    
                    onmouseup = function()
                    {
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
                
                ___InsertControl();
                
                if (this.TopIndex != null && this.TopIndex > 0 && this.TopIndex < this.Items.Count)
                {
                    var n = this.TopIndex * __itemHeight;

                    if (n > __scrollHeight - __innerHeight)
                    {
                        this.TopIndex = Math.ceil((__scrollHeight - __innerHeight) / __itemHeight);
                    }
                    
                    this.ScrollBar._ScrollTo(this.TopIndex * __itemHeight, true);
                    ___FocusItem(this.TopIndex);
                }
                else
                {
                    this.TopIndex = 0;
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
                    
                    if (__scrollable)
                    {
                        __this.ScrollBar._EVENTS.MouseWheel(evt, true);
                    }
                    
                    if (typeof __this.OnMouseWheel == "function")
                    {
                        __this.OnMouseWheel(__this, evt);
                    }
                }
            }
        },
        KeyPress: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for keypress.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.KeyPress) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (typeof __this.OnKeyPress == "function")
                    {
                        __this.OnKeyPress(__this, evt);
                    }
                }
            }
        },
        KeyDown: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for keydown.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.KeyDown) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (__this.SelectionMode == __System.Controls.UI.Components.SelectionMode.MultiExtended || __this.SelectionMode == __System.Controls.UI.Components.SelectionMode.One)
                    {
                        if (__this.Items.Count > 0 && __timer == null)
                        {
                            __curEvent = { shiftKey: evt.shiftKey, ctrlKey: evt.ctrlKey };
                            
                            switch (evt.keyCode)
                            {
                                case 38:
                                    __timer = setTimeout(__controlName + "._MoveToItemByDirection(-1, true)", __keyboardSpeed);
                                    break;
                                case 40:
                                    __timer = setTimeout(__controlName + "._MoveToItemByDirection(1, true)", __keyboardSpeed);
                                    break;
                            }
                        }
                    }
                    
                    if (typeof __this.OnKeyDown == "function")
                    {
                        __this.OnKeyDown(__this, evt);
                    }
                }
            }
        },
        KeyUp: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
        {
            // summary:
            //   Page event handler for keyup.
            //
            // arguments:
            //   evt (required)
            //   bypassMonitor (optional)
            //
            // returns: Nothing
            
            if (__this.Created)
            {
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.KeyUp) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (__this.SelectionMode == __System.Controls.UI.Components.SelectionMode.MultiExtended || __this.SelectionMode == __System.Controls.UI.Components.SelectionMode.One)
                    {
                        clearTimeout(__timer);
                        __timer = null;
                        
                        if (__this.Items.Count > 0 && !__hasScrolled)
                        {
                            __curEvent = { shiftKey: evt.shiftKey, ctrlKey: evt.ctrlKey };
                            
                            switch (evt.keyCode)
                            {
                                case 38:
                                    __this._MoveToItemByDirection(-1);
                                    break;
                                case 40:
                                    __this._MoveToItemByDirection(1);
                                    break;
                            }
                        }
                        
                        __curEvent = null;
                        __hasScrolled = false;
                    }
                    
                    if (typeof __this.OnKeyUp == "function")
                    {
                        __this.OnKeyUp(__this, evt);
                    }
                }
            }
        }
    }
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);
    
    if (__resource.Args["ScrollBar"])
    {
        __resource.Children.push(this.ScrollBar);
    }
    
    __System.Controls.Event.Add(this, __System.Controls.EventType.FocusOut);
}

if (typeof ListBox == "undefined")
{
    ListBox = __System.Controls.UI.ListBox;
}

__System.Import("System.Controls.UI.ListBox", true);
__System.Import("System.Controls.UI.ListBox.ObjectCollection");
