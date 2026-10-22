////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.Resizer");
__System.Import("System.Controls.UI.ScrollBar");
__System.Import("System.Collections.Generic.List");
__System.Import("System.Controls.UI.Components.Enumerations");

__System.Controls.UI.TextBox = function(/*String*/ resource)
{
    var __pageName = "TextBox";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __contentNode = null;
    var __dropDownNode = null;
    var __textBoxNode = null;
    var __textBoxPositionNode = null;
    var __bypassFocusLeave = false;
    var __droppedDown = false;
    var __dropDownBypassFocusEnter = false;
    var __focusIndex = -1;
    var __hasScrolled = false;
    var __innerWidth = null;
    var __innerOffset = null;
    var __innerHeight = null;
    var __items = null
    var __itemCount = null;
    var __itemHeight = null;
    var __keyboardSpeed = 50;
    var __origPosition = null;
    var __outerHeight = null;
    var __resizeable = null;
    var __resizableWidth = null;
    var __resizableHeight = null;
    var __resizerGripSize = { Width: null, Height: null };
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __scrollable = false;
    var __scrollHeight = null;
    var __selectedIndex = -1;
    var __selectionLength = null;
    var __selectionStart = null;
    var __textBoxChanged = false;
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
    
    this.AutoCompleteCustomSource = null;
    this.AutoCompleteMode = __System.Controls.UI.Components.AutoCompleteMode.None;
    this.AutoCompleteSource = __System.Controls.UI.Components.AutoCompleteSource.None;
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
    this.Cursor = null;
    this.Focused = false;
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.Left = 0;
    this.Location = { X: null, Y: null };
    this.MaxLength = null;
    this.MousePosition = { X: null, Y: null };
    this.Name = null;
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnGotFocus = null;
    this.OnKeyDown = null;
    this.OnKeyPress = null;
    this.OnKeyUp = null;
    this.OnLostFocus = null;
    this.OnMouseDown = null;
    this.OnMouseUp = null;
    this.OnMouseEnter = null;
    this.OnMouseHover = null;
    this.OnMouseLeave = null;
    this.OnMouseWheel = null;
    this.OnMove = null;
    this.OnSizeChanged = null;
    this.OnTextChanged = null;
    this.PageID = null;
    this.Parent = null;
    this.ReadOnly = false;
    this.Resizer = new __System.Controls.UI.Resizer();
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.TabIndex = null;
    this.Tag = null;
    this.Text = null;
    this.TextAlign = null;
    this.TextLength = null;
    this.TextPadding = null;
    this.Top = 0;
    this.UseSystemPasswordChar = false;
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
    
    this.SelectionLength =
    {
        set: function(/*Integer*/ length)
        {
            __selectionLength = length;
            
            if (__selectionStart != null)
            {
                ___SelectionLength(__selectionStart, __selectionLength);
            }
        }
    }
    
    this.SelectionStart =
    {
        set: function(/*Integer*/ index)
        {
            __selectionStart = index;
            
            if (__selectionLength != null)
            {
                ___SelectionLength(__selectionStart, __selectionLength);
            }
            else
            {
                ___SelectionStart(__selectionStart);
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
            var h = __Height;
            
            if (size0 != null)
            {
                __this.Width = __System.Convert.ToUInt32(size0);
            }
            
            if (size1 != null)
            {
                __this.DropDownHeight = __System.Convert.ToUInt32(size1);
            }
            
            if (__this.Created && (w != __this.Width || h != __Height))
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
    
    function ___ClickItem(/*String*/ text)
    {
        ___SetTextBoxValue(text);
        __this._HideDropDown();
    }
    
    function ___DisplayDropDown(/*List*/ items, /*Boolean*/ resizeable)
    {
        __resizerGripSize = { Width: (__this.Resizer.Grip != null && __this.Resizer.Grip.Width != null ? __this.Resizer.Grip.Width : __this.ScrollBar.VScrollBar.Width), Height: (__this.Resizer.Grip != null ? (__this.Resizer.Grip.Height != null ? __this.Resizer.Grip.Height : __this.ScrollBar.VScrollBar.Width) : 0) };
        
        __itemHeight = __resources["SelectedItemBg"].Height;
        __itemCount = items.Count;
        __scrollHeight = __itemHeight * __itemCount;
        
        __innerOffset = (__this.BorderStyle != null && __this.BorderSize > 0 ? - (__this.BorderSize * 2) : 0);
        
        var bResizable = (resizeable && __resizableWidth != null && __resizableHeight != null);
        
        if (bResizable)
        {
            __innerWidth = __resizableWidth + __innerOffset;
            __outerHeight = __resizableHeight;
            __innerHeight = __outerHeight + __innerOffset;        
        }
        else
        {
            __innerWidth = __this.Width + __innerOffset;
            __innerHeight = __outerHeight = __itemCount * __itemHeight;
            __outerHeight -= __innerOffset;
        }
        
        __scrollable = (__scrollHeight > __innerHeight);
        
        var scrollBarSize = (__scrollable ? __this.ScrollBar.VScrollBar.Width : 0);
        var itemOffset = scrollBarSize + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width;
        
        var s = '<table id="' + __controlName + '$ListItems" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="height:' + __scrollHeight + 'px">' +
                '<tr>' +
                '<td>' +
                '<ul unselectable="on" style="margin:0px">';
        
        for (var i = 0; i < __itemCount; i++)
        {
            s += '<li id="' + __controlName + '$Item$' + i + '" title="' + items[i] + '" unselectable="on" Index="' + i + '" style="position:absolute;top:' + (i * __itemHeight) + 'px;left:0px;height:' + __itemHeight + 'px;margin:0px">' +
                 '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;top:' + Math.floor((__itemHeight - __itemHeight) / 2) + 'px">' +
                 '<tr>' +
                 '<td id="' + __controlName + '$Item$Left$' + i + '" unselectable="on" style="width:' + __resources["SelectedItemLeft"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '<td' + (__this.RightToLeft ? ' dir="rtl"' : "") + ' id="' + __controlName + '$Item$Background$' + i + '" unselectable="on" style="height:' + __itemHeight + 'px" nowrap><h2 unselectable="on" style="font-weight:normal;margin:0px"><a id="' + __controlName + '$Item$Anchor$' + i + '" href="javascript:void(0)" unselectable="on" style="' + (__innerWidth > 0 ? "width:" + (__innerWidth - itemOffset) + "px;" : "") + (__this.ForeColor != null ? "color:" + __this.ForeColor + ";" : "") + 'text-decoration:none;text-overflow:ellipsis;white-space:nowrap;overflow:hidden' + (__this.Cursor != null ? ';cursor:' + __this.Cursor : '') + '">' + items[i] + '</a></h2></td>' +
                 '<td id="' + __controlName + '$Item$Right$' + i + '" unselectable="on" style="width:' + __resources["SelectedItemRight"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '</tr>' +
                 '</table>' +
                 '</li>';
        }
        
        s += '</ul>' +
             '</td>' +
             '</tr>' +
             '</table>';
        
        var p = __System.Controls.DOM.Bounds(__textBoxPositionNode, true);
        
        with (__dropDownNode)
        {
            style.left = p.X;
            style.top = p.Y + p.Height;
            style.width = (bResizable ? __resizableWidth : __this.Width);
            style.height = __outerHeight;
            style.backgroundColor = __System.Convert._IsNullToDefault(__this.BackColor, "");
            style.border = (__this.BorderStyle != null ? __this.BorderStyle + (__this.BorderSize != null ? " " + __this.BorderSize + "px" : "") + (__this.BorderColor != null ? " " + __this.BorderColor : "") : "");
            style.cursor = __System.Convert._IsNullToDefault(__this.Cursor, "");
            style.zIndex = __this.ZIndex;
            
            innerHTML = s;
        }
        
        if (__this.Font != null)
        {
            for (var i = 0; i < __itemCount; i++)
            {
                __System.Controls.DOM.ApplyFontStyle(__controlName + "$Item$Anchor$" + i, __this.Font);
            }
        }
        
        if (__scrollable || resizeable)
        {
            __this.ScrollBar.PageID = __dropDownNode.id;
            __this.ScrollBar.RightToLeftLayout = __this.RightToLeft;
            __this.ScrollBar.Width = (resizeable && __resizableWidth != null ? __resizableWidth : parseInt(__dropDownNode.style.width));
            __this.ScrollBar.Height = __outerHeight;
            __this.ScrollBar.BorderColor = __this.BorderColor;
            __this.ScrollBar.BorderSize = __this.BorderSize;
            __this.ScrollBar.BorderStyle = __this.BorderStyle;
            __this.ScrollBar.MouseWheel = __itemHeight;
            __this.ScrollBar.VerticalScrollBar = true;
            __this.ScrollBar.VScrollBar.Height = (resizeable ? __innerHeight - __resizerGripSize.Height : null);
            __this.ScrollBar.HorizontalScrollBar = false;
            __this.ScrollBar.Created = false;
            __this.ScrollBar.Load();
            
            if (resizeable)
            {
                __this.Resizer.PageID = __dropDownNode.id;
                __this.Resizer.RightToLeft = __this.RightToLeft;
                __this.Resizer.BorderSize = (__innerOffset != 0 ? __this.BorderSize : 1);
                __this.Resizer.BorderVisible = false;
                __this.Resizer.MinHeight = __itemHeight - __innerOffset;
                __this.Resizer.MinWidth = __resizerGripSize.Width - __innerOffset;
                __this.Resizer.NorthResizable = false;
                __this.Resizer.SouthResizable = (__this.Resizer.Grip == null);
                __this.Resizer.WestResizable = (__this.RightToLeft ? __this.Resizer.SouthResizable : false);
                __this.Resizer.EastResizable = (!__this.RightToLeft ? __this.Resizer.SouthResizable : false);
                
                if (__this.Resizer.Grip != null)
                {
                    __this.Resizer.Grip.RightToLeft = __this.RightToLeft;
                }
                
                __this.Resizer.OnSizeChanged = function(/*Bounds*/ bounds)
                {
                    bounds.Y = null;
                    
                    __outerHeight = bounds.Height;
                    __innerHeight = __outerHeight + __innerOffset;
                    __this.ScrollBar.VScrollBar.Height = __innerHeight - __resizerGripSize.Height;
                    
                    __this.ScrollBar.Bounds.set(bounds);
                    
                    var scrollBarSize = (__this.ScrollBar.VScrollBar.Visible ? __this.ScrollBar.VScrollBar.Width : 0);
                    var itemOffset = (scrollBarSize + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width);
                    
                    __innerWidth = bounds.Width + __innerOffset;
                    
                    for (var i = 0; i < __itemCount; i++)
                    {
                        document.getElementById(__controlName + "$Item$Anchor$" + i).style.width = Math.max(0, __innerWidth - itemOffset);
                    }
                }
                
                __this.Resizer.Load();
            }
        }
        
        for (var i = 0; i < __itemCount; i++)
        {
            with (document.getElementById(__controlName + "$Item$" + i))
            {
                onclick = function()
                {
                    ___ClickItem(items[parseInt(this.Index)]);
                }
                
                onfocusin = function()
                {
                    if (!__dropDownBypassFocusEnter)
                    {
                        ___Select(__selectedIndex, false, true);
                        
                        if (__scrollable)
                        {
                            ___MoveToItem(parseInt(this.Index));
                        }
                        
                        ___Select(parseInt(this.Index), true, true);
                    }
                    
                    __dropDownBypassFocusEnter = false;
                }
                
                onmousemove = function()
                {
                    ___Select(parseInt(this.Index), true, false, true);
                }
            }
        }
        
        __items = items;
        __selectedIndex = -1;
        __resizeable = resizeable;
        __droppedDown = true;
        
        __System.Controls.DOM.SetVisibility(__dropDownNode, true);
    }
    
    function ___FocusItem(/*Integer*/ index)
    {
        __focusIndex = index;
        document.getElementById(__controlName + "$Item$Anchor$" + __focusIndex).focus();
    }
    
    function ___HideResizer()
    {
        if (__resizeable)
        {
            __resizableWidth = parseInt(__dropDownNode.style.width);
            __resizableHeight = parseInt(__dropDownNode.style.height);
            
            __this.Resizer.Show(false);
        }
    }
    
    function ___InsertControl()
    {
        with (__contentNode)
        {
            style.left = __this.Left;
            style.top = __this.Top;
            style.height = Math.max(__this.Height - __this.Top - __this.Bottom, __resources["TextBoxBg"].Height);
            
            innerHTML = '<table id="' + __controlName + '$TextBoxPosition" dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;top:0px;height:0px;height:' + __resources["TextBoxBg"].Height + 'px">' +
                        '<tr>' +
                        '<td unselectable="on" style="width:' + __resources["TextBoxLeft"].Width + 'px;background:url(' + __resources["TextBoxLeft"].Build()  + ');white-space:nowrap" nowrap></td>' +
                        '<td unselectable="on" style="width:' + (__this.Width - __this.Left - __this.Right - __resources["TextBoxLeft"].Width - __resources["TextBoxRight"].Width) + 'px;background:url(' + __resources["TextBoxBg"].Build() + ') repeat-x">' +
                        '</td>' +
                        '<td unselectable="on" style="width:' + __resources["TextBoxRight"].Width + 'px;background:url(' + __resources["TextBoxRight"].Build() + ');white-space:nowrap" nowrap></td>' +
                        '</tr>' +
                        '</table>' +
                        '<input id="' + __controlName + '$TextBox"' + (__this.RightToLeft ? ' dir="rtl"' : '') + ' type="' + (__this.UseSystemPasswordChar ? "password" : "text") + '"' + (__this.MaxLength != null ? ' maxlength="' + __this.MaxLength + '"' : '') + (__this.ReadOnly ? ' readonly="true"' : '') + ' value="' + __System.Convert._IsNullToDefault(__this.Text, "") + '" style="position:absolute;top:' + __this.BorderSize + 'px;left:' + __this.BorderSize + 'px;border:none;z-index:1" />';
        }
        
        __textBoxNode = document.getElementById(__controlName + "$TextBox");
        __textBoxPositionNode = document.getElementById(__controlName + "$TextBoxPosition");
        
        with (__textBoxNode)
        {
            style.width = __this.Width - __this.Left - __this.Right - (__this.BorderSize * 2);
            style.height = __resources["TextBoxBg"].Height - (__this.BorderSize * 2);
            style.textAlign = __System.Convert._IsNullToDefault(__this.TextAlign, "");
            style.padding = __System.Convert._IsNullToDefault(__this.TextPadding, "");
            style.color = __System.Convert._IsNullToDefault(__this.ForeColor, "");
            style.cursor = __System.Convert._IsNullToDefault(__this.Cursor, "");
            
            __System.Controls.DOM.ApplyFontStyle(__textBoxNode, __this.Font);
            
            onfocus = function()
            {
                if (!__this.Focused)
                {
                    __this._HideDropDown();
                    
                    if (!__this.ContainsFocus)
                    {
                        ___TryEventFocus();
                    }
                    
                    if (__textBoxChanged)
                    {
                        ___SelectionLength(0, this.value.length);
                    }
                    
                    __this.Focused = true;
                }
            }
            
            onfocusout = function()
            {
                __this.Focused = false;
            }
            
            onmousedown = function()
            {
                this.focus();
            }
            
            onmouseenter = function()
            {
                if (typeof __this.OnMouseEnter == "function")
                {
                    __this.OnMouseEnter(__this, event);
                }
            }
            
            onkeydown = function()
            {
                if (this.value == "")
                {
                    __this._HideDropDown();
                }
            }
            
            onkeyup = function()
            {
                if (__this.Text != this.value)
                {
                    __textBoxChanged = true;
                    
                    if (!__this.UseSystemPasswordChar && this.value != "")
                    {
                        if (__this.AutoCompleteMode != __System.Controls.UI.Components.AutoCompleteMode.None && __this.AutoCompleteSource != __System.Controls.UI.Components.AutoCompleteSource.None)
                        {
                            var search = this.value;
                            var result = new __System.Collections.Generic.List();
                            
                            if (__this.AutoCompleteSource == __System.Controls.UI.Components.AutoCompleteSource.CustomSource && __this.AutoCompleteCustomSource != null)
                            {
                                var o = null;
                                
                                try
                                {
                                    o = __this.AutoCompleteCustomSource.GetEnumerator();
                                }
                                catch (e)
                                {
                                }
                                
                                if (o != null)
                                {
                                    while (o.MoveNext())
                                    {
                                        if (__this.AutoCompleteCustomSource[o.Current].substring(0, search.length).toLowerCase() == search.toLowerCase())
                                        {
                                            result.Add(__this.AutoCompleteCustomSource[o.Current]);
                                        }
                                    }
                                }
                            }
                            
                            if (result != null && result.Count > 0)
                            {
                                if (__this.AutoCompleteMode == __System.Controls.UI.Components.AutoCompleteMode.Append || __this.AutoCompleteMode == __System.Controls.UI.Components.AutoCompleteMode.SuggestAppend)
                                {
                                    switch (event.keyCode)
                                    {
                                        case 8:
                                        case 46:
                                            break;
                                        default:
                                            this.value = result[0];
                                            ___SelectionLength(search.length, this.value.length - search.length);
                                    }
                                }
                                
                                if (__this.AutoCompleteMode == __System.Controls.UI.Components.AutoCompleteMode.Suggest || __this.AutoCompleteMode == __System.Controls.UI.Components.AutoCompleteMode.SuggestAppend)
                                {
                                    ___DisplayDropDown(result, true);
                                }
                            }
                            else
                            {
                                __this._HideDropDown();
                            }
                        }
                    }
                }
                
                __this.Text = this.value;
                __this.TextLength = this.value.length;
                
                if (this.value == "")
                {
                    __this._HideDropDown();
                }
            }
        }
    }
    
    function ___MoveToItem(/*Integer*/ index)
    {
        var y = 0;
        
        var y0 = Math.abs(__this.ScrollBar._ScrollTop());
        var y1 = index * __itemHeight;
        
        if (y1 + __itemHeight > __innerHeight)
        {
            if (y1 >= y0 && y1 + __itemHeight <= Math.min(y0 + __innerHeight, __scrollHeight))
            {
                y = -1;
            }
            else
            {
                y = y1;
                
                if (index >= __selectedIndex)
                {
                    y += __itemHeight - __innerHeight;
                }
            }
        }
        
        if (y != -1)
        {
            __this.ScrollBar._ScrollTo(y, true);
        }
        
        __selectedIndex = index;
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
        if (index >= 0 && index < __itemCount)
        {
            if ((__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) && __timer == null) || bypassTimer)
            {
                if (selectItem && index != __selectedIndex)
                {
                    if (__selectedIndex != -1)
                    {
                        if (bypassFocus && __focusIndex != -1)
                        {
                            __bypassFocusLeave = true;
                            
                            ___BlurElement(__controlName + "$Item$Anchor$" + __focusIndex);
                            __focusIndex = -1;
                            
                            __pageNode.focus();
                        }
                        
                        ___Select(__selectedIndex, false, true);
                    }
                    
                    __selectedIndex = index;
                }
                
                document.getElementById(__controlName + "$Item$Background$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemBg"].Build() : "") + ")";
                document.getElementById(__controlName + "$Item$Left$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemLeft"].Build() : "") + ")";
                document.getElementById(__controlName + "$Item$Right$" + index).style.background = "url(" + (selectItem ? __resources["SelectedItemRight"].Build() : "") + ")";
                
                if (selectItem)
                {
                    if (!bypassFocus && index == __selectedIndex)
                    {
                        ___FocusItem(index);
                    }
                    
                    if (bypassTimer)
                    {
                        ___SetTextBoxValue(__items[__selectedIndex]);
                    }
                }
            }
        }
    }
    
    function ___SelectionLength(/*Integer*/ start, /*Integer*/ length)
    {
        if (!__this.ReadOnly)
        {
            with (__textBoxNode.createTextRange())
            {
                collapse(true);
                moveStart("character", start);
                moveEnd("character", length);
                select();
            }
        }
    }
    
    function ___SelectionStart(/*Integer*/ index)
    {
        if (!__this.ReadOnly)
        {
            with (__textBoxNode.createTextRange())
            {
                collapse(true);
                moveStart("character", index);
                moveEnd("character", 0);
                select();
            }
        }
    }
    
    function ___SetTextBoxValue(/*String*/ text)
    {
        __this.Text = __textBoxNode.value = text;
        __this.TextLength = text.length;
        __textBoxChanged = false;
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
    
    this._HideDropDown = function()
    {
        if (__droppedDown)
        {
            __selectedIndex = -1;
            
            ___HideResizer();
            this.ScrollBar.Show(false);
            
            __dropDownNode.style.zIndex = -1;
            __System.Controls.DOM.SetVisibility(__dropDownNode, false);
            
            __droppedDown = false;
        }
    }
    
    this._MoveToItemByDirection = function(/*Integer*/ direction, /*Boolean*/ useTimerRepeat)
    {
        var index = Math.min(Math.max(0, __selectedIndex + direction), __itemCount - 1);
        
        if (index != __selectedIndex)
        {
            ___Select(__selectedIndex, false, true);
            
            ___MoveToItem(index);
            
            __dropDownBypassFocusEnter = true;
            ___Select(index, true, true);
        }
        
        if (useTimerRepeat)
        {
            __timer = setTimeout(__controlName + "._MoveToItemByDirection(" + direction + ", true)", __keyboardSpeed);
        }
        
        __hasScrolled = true;
    }
    
    this.Focus = function()
    {
        __textBoxNode.focus();
    }
    
    this.SetBounds = function(/*Integer*/ x, /*Integer*/ y, /*Integer*/ width, /*Integer*/ height)
    {
        this.Bounds.set(x, y, width, height);
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
            
            __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            __System.Controls.DOM.SetVisibility(__contentNode, __visible);
            
            if (!__visible)
            {
                ___RemoveEventFocus();
                
                if (__droppedDown)
                {
                    if (__focusIndex != -1)
                    {
                        ___BlurElement(__controlName + "$Item$Anchor$" + __focusIndex);
                        __focusIndex = -1;
                    }
                    
                    __this._HideDropDown();
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
                if (this.Width != null)
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
                            
                            __contentNode = __System.Controls.DOM.Append({
                                                                           ID: this.PageID + "$Content",
                                                                           X: 0,
                                                                           Y: 0,
                                                                           Visibility: false,
                                                                           Parent: __pageNode
                                                                         });
                            
                            __dropDownNode = __System.Controls.DOM.Append({
                                                                            ID: this.PageID + "$DropDown",
                                                                            Visibility: false,
                                                                            ZIndex: -1
                                                                          });
                        }
                        else
                        {
                            style.position = __origPosition;
                        }
                        
                        if (this.Location.X != null || this.Location.Y != null)
                        {
                            style.position = "absolute";
                        }
                        
                        var n = (this.Height != null ? Math.max(this.Height - this.Top - this.Bottom, __resources["TextBoxBg"].Height) : __resources["TextBoxBg"].Height);
                        
                        if (n == __resources["TextBoxBg"].Height)
                        {
                            this.Height = n + this.Top + this.Bottom;
                        }
                        
                        style.left = __System.Convert._IsNullToDefault(this.Location.X, "");
                        style.top = __System.Convert._IsNullToDefault(this.Location.Y, "");
                        style.width = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Width), "");
                        style.height = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(this.Height), "");
                        style.backgroundColor = __System.Convert._IsNullToDefault(this.BackColor, "");
                        style.backgroundImage = "url(" + __System.Convert._IsNullToDefault(this.BackgroundImage, "") + ")";
                        style.backgroundPosition = __System.Convert._IsNullToDefault(this.BackgroundImageLayout, "");
                        style.backgroundRepeat = __System.Convert._IsNullToDefault(this.BackgroundImageRepeat, "");
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
                    }
                    
                    ___InsertControl();
                    this._HideDropDown();
                    
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
                            if (!__bypassFocusLeave)
                            {
                                var n = __System.Controls.DOM.IsParentElement(evt.toElement, __pageNode);
                                
                                if (n == -1)
                                {
                                    n = __System.Controls.DOM.IsParentElement(evt.toElement, __dropDownNode);
                                }
                                
                                if (n != -1)
                                {
                                    return n;
                                }
                                else
                                {
                                    __this._HideDropDown();
                                    ___RemoveEventFocus();
                                    
                                    if (typeof __this.OnLostFocus == "function")
                                    {
                                        __this.OnLostFocus(__this, evt);
                                    }
                                }
                            }
                            
                            __bypassFocusLeave = false;
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
                    
                    if (__droppedDown)
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
                    ___RemoveEventMouseClick();
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
                    
                    if (evt.keyCode == 27)
                    {
                        __this._HideDropDown();
                    }
                    
                    if (__droppedDown)
                    {
                        switch (evt.keyCode)
                        {
                            case 38:
                            case 40:
                                break;
                            default:
                                __textBoxNode.focus();
                        }
                    }
                    
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
                    
                    if (__droppedDown)
                    {
                        if (__timer == null)
                        {
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
                    
                    if (__textBoxChanged)
                    {
                        if (typeof __this.OnTextChanged == "function")
                        {
                            __this.OnTextChanged(__this, evt);
                        }
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
                    
                    if (__droppedDown)
                    {
                        clearTimeout(__timer);
                        __timer = null;
                        
                        if (!__hasScrolled)
                        {
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

if (typeof TextBox == "undefined")
{
    TextBox = __System.Controls.UI.TextBox;
}

__System.Import("System.Controls.UI.TextBox", true);

