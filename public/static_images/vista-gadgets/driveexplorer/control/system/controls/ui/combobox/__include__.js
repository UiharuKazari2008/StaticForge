////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.Resizer");
__System.Import("System.Controls.UI.ScrollBar");
__System.Import("System.Controls.UI.Components.Enumerations");

__System.Controls.UI.ComboBox = function(/*String*/ resource)
{
    var __pageName = "ComboBox";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __contentNode = null;
    var __dropDownNode = null;
    var __dropDownImageNode = null;
    var __textBoxNode = null;
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
    var __itemWidth = null;
    var __itemMaxHeight = null;
    var __keyboardSpeed = 50;
    var __origPosition = null;
    var __outerHeight = null;
    var __resizeable = null;
    var __resizableWidth = null;
    var __resizableHeight = null;
    var __resizerGripSize = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = { DropDownArrow: null };
    var __scrollable = false;
    var __scrollHeight = null;
    var __selectedIndex = -1;
    var __selectionLength = null;
    var __selectionStart = null;
    var __textBoxChanged = false;
    var __textBoxNodeValue = null;
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
            __resource.Args["Resizer"] = (resource["Resizer"] != null ? resource["Resizer"] : null);
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
    this.Cursor = "default";
    this.DropDownHeight = null;
    this.DropDownStyle = __System.Controls.UI.Components.ComboBoxStyle.DropDown;
    this.DropDownWidth = null;
    this.DroppedDown = false;
    this.Focused = false;
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.IntegralHeight = false;
    this.ItemHeight = null;
    this.Items = new __System.Collections.Generic.List(),
    this.Left = 0;
    this.Location = { X: null, Y: null };
    this.MaxDropDownItems = null;
    this.MaxLength = null;
    this.MousePosition = { X: null, Y: null };
    this.Name = null;
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.OnDropDown = null;
    this.OnDropDownClosed = null;
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
    this.OnMove = null;
    this.OnSelectedIndexChanged = null;
    this.OnSelectedItemChanged = null;
    this.OnSelectedValueChanged = null;
    this.OnSelectionChangeCommitted = null;
    this.OnSizeChanged = null;
    this.OnTextChanged = null;
    this.PageID = null;
    this.Parent = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.SelectedIndex = -1;
    this.SelectedItem = null;
    this.SelectedPadding = null;
    this.SelectedText = null;
    this.SelectedValue = null;
    this.Sorted = false;
    this.TabIndex = null;
    this.Tag = null;
    this.Text = null;
    this.Top = 0;
    this.ValueMember = null;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
    
    this.Resizer = new __System.Controls.UI.Resizer(__resource.Args["Resizer"]);
    
    if (!__resource.Args["Resizer"])
    {
        __resource.Children.push(this.Resizer);
    }
    
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
                with (__pageNode.style)
                {
                    if (__this.Location.X != null || __this.Location.Y != null)
                    {
                        position = "absolute";
                    }
                    
                    left = __System.Convert._IsNullToDefault(__System.Convert.ToInt32(__this.Location.X), left);
                    top = __System.Convert._IsNullToDefault(__System.Convert.ToInt32(__this.Location.Y), top);
                    
                    if (b)
                    {
                        width = __System.Convert._IsNullToDefault(__this.Width, width);
                        height = __System.Convert._IsNullToDefault(__this.Height, height);
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
                __this.Height = __System.Convert.ToUInt32(size1);
            }
            
            if (__this.Created && (w != __this.Width || h != __Height))
            {
                if (!_calculateSize)
                {
                    with (__pageNode.style)
                    {
                        width = __System.Convert._IsNullToDefault(__this.Width, width);
                        height = __System.Convert._IsNullToDefault(__this.Height, height);
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
    
    function ___ClickItem(/*Integer*/ index)
    {
        ___SelectItem(index);
        ___HideDropDown();
    }
    
    function ___ClickItemAutoComplete(/*String*/ text)
    {
        var listIndex = new __System.Collections.Generic.List();
        
        var o = __this.Items.GetEnumerator();
        
        while (o.MoveNext())
        {
            listIndex.Add((__this.AutoCompleteSource != __System.Controls.UI.Components.AutoCompleteSource.ListItems ? __System.Convert._IsNullToDefault(___ValueMember(__this.Items[o.Current], true), "").toString() : __this.Items[o.Current]));
        }
        
        var n = listIndex.FindIndex(function(/*String*/ search)
        {
            if (search != null)
            {
                return ((__this.AutoCompleteSource != __System.Controls.UI.Components.AutoCompleteSource.ListItems ? search.substring(0, text.length) : search) == text);
            }
            
            return false;
        });
        
        if (n == -1 && __this.AutoCompleteSource != __System.Controls.UI.Components.AutoCompleteSource.ListItems)
        {
            n = listIndex.FindIndex(function(/*String*/ search)
            {
                if (search != null)
                {
                    return (search.substring(0, text.length).toLowerCase() == text.toLowerCase());
                }
                
                return false;
            });
        }
        
        if (n != -1)
        {
            ___ClickItem(n);
        }
        else
        {
            __this.SelectedIndex = -1;
            __this.SelectedItem = null;
            __this.SelectedValue = text;
            
            ___SetTextBoxValue(__this.SelectedValue);
            ___HideDropDown();
        }
    }
    
    function ___DisplayDropDown(/*List*/ items, /*Boolean*/ resizeable)
    {
        __itemMaxHeight = (__this.ItemHeight != null ? Math.max(__this.ItemHeight, __resources["SelectedItemBg"].Height) : __resources["SelectedItemBg"].Height);
        __resizerGripSize = { Width: (__this.Resizer.Grip != null && __this.Resizer.Grip.Width != null ? __this.Resizer.Grip.Width : __this.ScrollBar.VScrollBar.Width), Height: (__this.Resizer.Grip != null ? (__this.Resizer.Grip.Height != null ? __this.Resizer.Grip.Height : __this.ScrollBar.VScrollBar.Width) : 0) };
        
        __itemCount = (__this.MaxDropDownItems != null ? Math.min(items.Count, __this.MaxDropDownItems) : items.Count);
        __scrollHeight = __itemMaxHeight * __itemCount;
        
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
            __outerHeight = __this.DropDownHeight;
            
            if (__this.IntegralHeight && __this.DropDownHeight != null)
            {
                __outerHeight = Math.ceil(__this.DropDownHeight / __itemMaxHeight) * __itemMaxHeight;
            }
            
            __innerWidth = 0;
            __innerHeight = __outerHeight = (__this.DropDownHeight == null ? __itemCount * __itemMaxHeight : __outerHeight);
            
            if (__this.BorderStyle != null && __this.BorderSize > 0)
            {
                if (resizeable || __this.DropDownHeight == null || (__this.IntegralHeight && __this.DropDownHeight != null))
                {
                    __outerHeight += __this.BorderSize * 2;
                }
                else
                {
                    __innerHeight -= __this.BorderSize * 2;
                }
            }
            
            __innerWidth = (__this.DropDownWidth != null ? __this.DropDownWidth + __innerOffset : 0);
        }
        
        __scrollable = (__scrollHeight > __innerHeight);
        
        var scrollBarSize = (__scrollable ? __this.ScrollBar.VScrollBar.Width : 0);
        var itemOffset = scrollBarSize + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width;
        
        if (__this.Sorted)
        {
            items.Sort(new function()
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
        
        for (var i = 0; i < __itemCount; i++)
        {
            s += '<li id="' + __controlName + '$Item$' + i + '" title="' + ___ValueMember(items[i]) + '" unselectable="on" Index="' + i + '" style="position:absolute;top:' + (i * __itemMaxHeight) + 'px;left:0px;height:' + __itemMaxHeight + 'px;margin:0px">' +
                 '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;top:' + Math.floor((__itemMaxHeight - __resources["SelectedItemBg"].Height) / 2) + 'px">' +
                 '<tr>' +
                 '<td id="' + __controlName + '$Item$Left$' + i + '" unselectable="on" style="width:' + __resources["SelectedItemLeft"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '<td' + (__this.RightToLeft ? ' dir="rtl"' : "") + ' id="' + __controlName + '$Item$Background$' + i + '" unselectable="on" style="height:' + __resources["SelectedItemBg"].Height + 'px" nowrap><h2 unselectable="on" style="font-weight:normal;margin:0px"><a id="' + __controlName + '$Item$Anchor$' + i + '" href="javascript:void(0)" unselectable="on" style="' + (__innerWidth > 0 ? "width:" + (__innerWidth - itemOffset) + "px;" : "") + (__this.ForeColor != null ? "color:" + __this.ForeColor + ";" : "") + 'text-decoration:none;text-overflow:ellipsis;white-space:nowrap;overflow:hidden' + (__this.Cursor != null ? ';cursor:' + __this.Cursor : '') + '">' + ___ValueMember(items[i]) + '</a></h2></td>' +
                 '<td id="' + __controlName + '$Item$Right$' + i + '" unselectable="on" style="width:' + __resources["SelectedItemRight"].Width + 'px;white-space:nowrap" nowrap></td>' +
                 '</tr>' +
                 '</table>' +
                 '</li>';
        }
        
        s += '</ul>' +
             '</td>' +
             '</tr>' +
             '</table>';
        
        var p = __System.Controls.DOM.Bounds(__contentNode, true);
        
        with (__dropDownNode)
        {
            style.left = p.X;
            style.top = p.Y + p.Height;
            style.width = (bResizable ? __resizableWidth : __System.Convert._IsNullToDefault(__this.DropDownWidth, ""));
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
        
        if (!bResizable && __this.DropDownWidth == null)
        {
            for (var i = 0; i < __itemCount; i++)
            {
                __innerWidth = Math.max(__innerWidth, document.getElementById(__controlName + "$Item$Anchor$" + i).offsetWidth);
            }
            
            for (var i = 0; i < __itemCount; i++)
            {
                document.getElementById(__controlName + "$Item$Anchor$" + i).style.width = __innerWidth;
            }
            
            __innerWidth += itemOffset;
            
            document.getElementById(__controlName + "$ListItems").style.width = __innerWidth;
            __dropDownNode.style.width = __innerWidth - __innerOffset;
        }
        
        __itemWidth = __innerWidth - scrollBarSize;
        
        if (__scrollable || resizeable)
        {
            __this.ScrollBar.PageID = __dropDownNode.id;
            __this.ScrollBar.RightToLeftLayout = __this.RightToLeft;
            __this.ScrollBar.Width = (resizeable && __resizableWidth != null ? __resizableWidth : parseInt(__dropDownNode.style.width));
            __this.ScrollBar.Height = __outerHeight;
            __this.ScrollBar.BorderColor = __this.BorderColor;
            __this.ScrollBar.BorderSize = __this.BorderSize;
            __this.ScrollBar.BorderStyle = __this.BorderStyle;
            __this.ScrollBar.MouseWheel = __itemMaxHeight;
            __this.ScrollBar.VerticalScrollBar = true;
            __this.ScrollBar.VScrollBar.Height = (resizeable && __resizerGripSize.Height > 0 ? __innerHeight - __resizerGripSize.Height : null);
            __this.ScrollBar.HorizontalScrollBar = false;
            __this.ScrollBar.Created = false;
            __this.ScrollBar.Load();
            
            if (resizeable)
            {
                __this.Resizer.PageID = __dropDownNode.id;
                __this.Resizer.RightToLeft = __this.RightToLeft;
                __this.Resizer.BorderSize = (__innerOffset != 0 ? __this.BorderSize : 1);
                __this.Resizer.BorderVisible = false;
                __this.Resizer.MinHeight = __itemMaxHeight - __innerOffset;
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
                    __outerHeight = bounds.Height;
                    __innerHeight = __outerHeight + __innerOffset;
                    __this.ScrollBar.VScrollBar.Height = __innerHeight - __resizerGripSize.Height;
                    
                    __this.ScrollBar.Bounds.set(bounds);
                    
                    var scrollBarSize = (__this.ScrollBar.VScrollBar.Visible ? __this.ScrollBar.VScrollBar.Width : 0);
                    var itemOffset = (scrollBarSize + __resources["SelectedItemLeft"].Width + __resources["SelectedItemRight"].Width);
                    
                    __innerWidth = bounds.Width + __innerOffset;
                    __itemWidth = __innerWidth - scrollBarSize;
                    
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
                    if (items == __this.Items)
                    {
                        ___ClickItem(parseInt(this.Index));
                    }
                    else
                    {
                        ___ClickItemAutoComplete(items[parseInt(this.Index)]);
                    }
                    
                    if (typeof __this.OnSelectionChangeCommitted == "function")
                    {
                        __this.OnSelectionChangeCommitted(__this);
                    }
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
        
        __System.Controls.DOM.SetVisibility(__dropDownNode, true);
        
        __auxilaryDroppedDown = true;
    }
    
    function ___FocusItem(/*Integer*/ index)
    {
        __focusIndex = index;
        document.getElementById(__controlName + "$Item$Anchor$" + __focusIndex).focus();
    }
    
    function ___HideDropDown(/*Boolean*/ fromImageNode)
    {
        if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple)
        {
            __selectedIndex = -1;
            
            ___HideResizer();
            __this.ScrollBar.Show(false);
            
            __dropDownNode.style.zIndex = -1;
            __System.Controls.DOM.SetVisibility(__dropDownNode, false);
            
            __System.Controls.DOM.SetImageSrc(__dropDownImageNode, __resources["DropDownArrow"].Build((fromImageNode ? 1 : 0), __this.RightToLeft));
            
            if (__droppedDown)
            {
                __this.DroppedDown = __droppedDown = false;
                
                if (typeof __this.OnDropDownClosed == "function")
                {
                    __this.OnDropDownClosed(__this);
                }
            }
            
            __auxilaryDroppedDown = false;
        }
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
            style.left = (__this.RightToLeft ? __this.Right : __this.Left);
            style.top = __this.Top;
            style.height = __resources["TextBoxBg"].Height;
            
            innerHTML = '<table dir="ltr" cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;height:' + __resources["TextBoxBg"].Height + 'px">' +
                        '<tr>' +
                        '<td unselectable="on" style="width:' + __resources["TextBoxLeft"].Width + 'px;background:url(' + __resources["TextBoxLeft"].Build() + ');white-space:nowrap" nowrap></td>' +
                        '<td unselectable="on" style="width:' + (__this.Width - __this.Left - __this.Right - __resources["TextBoxLeft"].Width - __resources["TextBoxRight"].Width) + 'px;background:url(' + __resources["TextBoxBg"].Build() + ') repeat-x">' +
                        '</td>' +
                        '<td unselectable="on" style="width:' + __resources["TextBoxRight"].Width + 'px;background:url(' + __resources["TextBoxRight"].Build() + ');white-space:nowrap" nowrap></td>' +
                        '</tr>' +
                        '</table>' +
                        '<table' + (__this.RightToLeft ? ' dir="rtl"' : '') + ' cellspacing="0" cellpadding="0" border="0" unselectable="on" style="position:absolute;top:0px;left:' + (__this.RightToLeft ? "0" : __this.BorderSize) + 'px;z-index:1">' +
                        '<tr>' +
                        '<td unselectable="on">' +
                        (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.DropDownList ? '<input id="' + __controlName + '$TextBox" type="text"' + (__this.MaxLength != null ? ' maxlength="' + __this.MaxLength + '"' : '') + ' style="border:none" />' : '<div id="' + __controlName + '$TextBox" unselectable="on" style="white-space:nowrap;overflow:hidden"></div>') +
                        '</td>' +
                        (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple ? '<td unselectable="on"><img id="' + __controlName + '$DropDown$Image" unselectable="on" /></td>' : '') +
                        '</tr>' +
                        '</table>';
        }
        
        __textBoxNode = document.getElementById(__controlName + "$TextBox");
        __dropDownImageNode = (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple ? document.getElementById(__controlName + "$DropDown$Image") : null);
        
        with (__textBoxNode)
        {
            style.width = __this.Width - __this.Left - __this.Right - (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple ? __resources["DropDownArrow"].Width : 0) - __this.BorderSize;
            style.height = __resources["DropDownArrow"].Height - (__this.BorderSize * 2);
            style.color = __System.Convert._IsNullToDefault(__this.ForeColor, "");
            style.padding = __System.Convert._IsNullToDefault(__this.SelectedPadding, "");
            style.cursor = (__this.DropDownStyle == __System.Controls.UI.Components.ComboBoxStyle.DropDownList ? __System.Convert._IsNullToDefault(__this.Cursor, "") : "");
            
            __System.Controls.DOM.ApplyFontStyle(__textBoxNode, __this.Font);
            
            if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.DropDownList)
            {
                onfocus = function()
                {
                    ___HideDropDown();
                    
                    if (__this.SelectedIndex != -1)
                    {
                        if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.DropDownList)
                        {
                            ___SelectionLength(0, this.value.length);
                        }
                    }
                    else
                    {
                        __textBoxNode.style.color = __System.Convert._IsNullToDefault(__this.ForeColor, "");
                        __textBoxNode.style.padding = __System.Convert._IsNullToDefault(__this.SelectedPadding, "");
                    }
                    
                    if (!__this.ContainsFocus)
                    {
                        ___TryEventFocus();
                    }
                    
                    __this.Focused = true;
                }
                
                onfocusout = function()
                {
                    __this.Focused = false;
                }
                
                onkeyup = function()
                {
                    if (__textBoxNodeValue != this.value)
                    {
                        __textBoxChanged = true;
                        
                        if (this.value != "")
                        {
                            if (__this.AutoCompleteMode != __System.Controls.UI.Components.AutoCompleteMode.None && __this.AutoCompleteSource != __System.Controls.UI.Components.AutoCompleteSource.None)
                            {
                                var search = this.value;
                                var result = new __System.Collections.Generic.List();
                                
                                if (__this.AutoCompleteSource == __System.Controls.UI.Components.AutoCompleteSource.ListItems)
                                {
                                    result = __this.Items.FindAll(function(obj)
                                    {
                                        if (obj != null)
                                        {
                                            obj = ___ValueMember(obj).toString();
                                            return (obj.substring(0, search.length).toLowerCase() == search.toLowerCase());
                                        }
                                        
                                        return false;
                                    });
                                }
                                else if (__this.AutoCompleteSource == __System.Controls.UI.Components.AutoCompleteSource.CustomSource && __this.AutoCompleteCustomSource != null)
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
                                            if (o[o.Current].substring(0, search.length).toLowerCase() == search.toLowerCase())
                                            {
                                                result.Add(o[o.Current]);
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
                                                this.value = ___ValueMember(result[0]);
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
                                    ___HideDropDown();
                                }
                            }
                        }
                    }
                    
                    __textBoxNodeValue = this.value;
                }
            }
        }
        
        if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple)
        {
            with (__dropDownImageNode)
            {
                style.width = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(__resources["DropDownArrow"].Width), "");
                style.height = __System.Convert._IsNullToDefault(__System.Convert.ToUInt32(__resources["DropDownArrow"].Height), "");
                
                src = __resources["DropDownArrow"].Build(0, __this.RightToLeft);
                
                if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.Simple)
                {
                    onmouseenter = function()
                    {
                        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) && !__auxilaryDroppedDown)
                        {
                            __System.Controls.DOM.SetImageSrc(this, __resources["DropDownArrow"].Build(1, __this.RightToLeft));
                        }
                    }
                    
                    onmouseleave = function()
                    {
                        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) && !__auxilaryDroppedDown)
                        {
                            __System.Controls.DOM.SetImageSrc(this, __resources["DropDownArrow"].Build(0, __this.RightToLeft));
                        }
                    }
                    
                    onmousedown = function()
                    {
                        if (___TryEventMouseClick(__this))
                        {
                            if (!__auxilaryDroppedDown)
                            {
                                if (typeof __this.OnDropDown == "function")
                                {
                                    __this.OnDropDown(__this);  
                                }
                                
                                __System.Controls.DOM.SetImageSrc(this, __resources["DropDownArrow"].Build(2, __this.RightToLeft));
                                
                                ___DisplayDropDown(__this.Items);
                                ___SelectDropDown(true);
                            }
                            else
                            {
                                ___HideDropDown(true);
                            }
                        }
                    }
                    
                    onmouseup = function()
                    {
                        if (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                        {
                            __System.Controls.DOM.SetImageSrc(this, __resources["DropDownArrow"].Build((__auxilaryDroppedDown ? 2 : 1), __this.RightToLeft));
                        }
                    }
                }
            }
        }
    }
    
    function ___MoveToItem(/*Integer*/ index)
    {
        var y = 0;
        
        var y0 = Math.abs(__this.ScrollBar._ScrollTop());
        var y1 = index * __itemMaxHeight;
        
        if (y1 + __itemMaxHeight > __innerHeight)
        {
            if (y1 >= y0 && y1 + __itemMaxHeight <= Math.min(y0 + __innerHeight, __scrollHeight))
            {
                y = -1;
            }
            else
            {
                y = y1;
                
                if (index >= __selectedIndex)
                {
                    y += __itemMaxHeight - __innerHeight;
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
                        ___SetTextBoxValue(___ValueMember(__items[__selectedIndex]));
                    }
                }
            }
        }
    }
    
    function ___SelectDropDown(/*Boolean*/ selectItem)
    {
        __this.DroppedDown = __droppedDown = true;
        
        if (selectItem && __this.SelectedIndex != -1)
        {
            ___TopIndex(__this.SelectedIndex);
            
            __dropDownBypassFocusEnter = true;
            ___Select(__this.SelectedIndex, true, true);
        }
    }
    
    function ___SelectItem(/*Integer*/ index, /*Boolean*/ bypassSelect)
    {
        var sindex = __this.SelectedIndex;
        var item = __this.SelectedItem;
        var value = __this.SelectedValue;
        
        __this.SelectedIndex = index;
        __this.SelectedItem = __this.Items[__this.SelectedIndex];
        __this.SelectedValue = ___ValueMember(__this.SelectedItem);
        
        if (!bypassSelect)
        {
            if (sindex != -1 && __this.SelectedIndex != sindex)
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
        
        ___SetTextBoxValue(__this.SelectedValue);
    }
    
    function ___SelectionLength(/*Integer*/ start, /*Integer*/ length)
    {
        if (__textBoxNode != null)
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
        if (__textBoxNode != null)
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
        if (__this.DropDownStyle != __System.Controls.UI.Components.ComboBoxStyle.DropDownList)
        {
            __textBoxNode.value = __textBoxNodeValue = text;
            
            __textBoxChanged = false;
        }
        else
        {
            __textBoxNode.innerHTML = text;
        }
    }
    
    function ___TopIndex(/*Integer*/ index)
    {
        if (__scrollable)
        {
            var n = index * __itemMaxHeight;
            
            if (n > __scrollHeight - __innerHeight)
            {
                index = Math.ceil((__scrollHeight - __innerHeight) / __itemMaxHeight);
            }
            
            __this.ScrollBar._ScrollTo(index * __itemMaxHeight, true);
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
    
    function ___ValueMember(/*Object*/ obj, /*Boolean*/ bypassSource)
    {
        if (__this.AutoCompleteSource == __System.Controls.UI.Components.AutoCompleteSource.ListItems || bypassSource)
        {
            if (__this.ValueMember != null && obj != null && typeof obj == "object" && obj[__this.ValueMember] != null)
            {
                return obj[__this.ValueMember];
            }
        }
        
        return obj;
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
        if (__droppedDown && __itemCount > 0)
        {
            ___FocusItem(0);
        }
        else
        {
            __pageNode.focus();
        }
    }
    
    this.GetItemHeight = function()
    {
        return __itemMaxHeight;
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
                    
                    ___HideDropDown();
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
                        
                        style.left = __System.Convert._IsNullToDefault(__System.Convert.ToInt32(this.Location.X), "");
                        style.top = __System.Convert._IsNullToDefault(__System.Convert.ToInt32(this.Location.Y), "");
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
                        
                        style.height = Math.max(__resources["TextBoxBg"].Height + this.Top + this.Bottom, offsetHeight);
                    }
                    
                    ___InsertControl();
                    
                    if (this.Items.Count > 0)
                    {
                        this.SelectedIndex = Math.min(Math.max(0, this.SelectedIndex), this.Items.Count - 1);
                        ___SelectItem(this.SelectedIndex, true);
                    }
                    
                    if (this.DropDownStyle == __System.Controls.UI.Components.ComboBoxStyle.Simple)
                    {
                        ___DisplayDropDown(this.Items);
                        ___SelectDropDown();
                    }
                    else
                    {
                        ___HideDropDown();
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
                                    ___HideDropDown();
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
                    
                    if (__auxilaryDroppedDown)
                    {
                        __this.ScrollBar._EVENTS.MouseWheel(evt, true);
                    }
                }
            }
        },
        KeyPress: function(/*Event*/ evt, /*Boolean*/ bypassMonitor)
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
                if (__visible && (bypassMonitor || __System.Threading.Monitor._Current(__System.Controls.EventType.KeyPress) == __this))
                {
                    evt = (evt != null ? evt : event);
                    
                    if (evt.keyCode == 27)
                    {
                        ___HideDropDown();
                    }
                    
                    if (__auxilaryDroppedDown)
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
                    
                    if (__auxilaryDroppedDown)
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
                        __this.OnKeyDown(__this, event);
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
                    
                    if (__auxilaryDroppedDown)
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
    
    if (__resource.Args["Resizer"])
    {
        __resource.Children.push(this.Resizer);
    }
    
    if (__resource.Args["ScrollBar"])
    {
        __resource.Children.push(this.ScrollBar);
    }
    
    __System.Controls.Event.Add(this, __System.Controls.EventType.FocusOut);
}

if (typeof ComboBox == "undefined")
{
    ComboBox = __System.Controls.UI.ComboBox;
}

__System.Import("System.Controls.UI.ComboBox", true);
