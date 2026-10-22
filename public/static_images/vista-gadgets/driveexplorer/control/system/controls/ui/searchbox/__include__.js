////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.TextBox");
__System.Import("System.Controls.UI.ListBox");
__System.Import("System.Controls.UI.Spinner");

__System.Controls.UI.SearchBox = function(/*String*/ resource, /*String*/ locale)
{
    var __pageName = "SearchBox";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __contentNode = null;
    var __dropDownNode = null;
    var __searchButtonNode = null;
    var __searchButtonNodeImage = null;
    var __textBoxNode = null;
    var __textBoxInputNode = null;
    var __textBoxPositionNode = null;
    var __droppedDown = false;
    var __keyDown = false;
    var __locale = { Path: null, Xml: null, Parsing: false, Lang: null };
    var __localeLang = null;
    var __localization = [];
    var __origPosition = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __retrieving = false;
    var __searchSent = false;
    var __selectedIndex = -1;
    var __statusDroppedDown = false;
    var __textBoxChanged = false;
    var __textBoxDelay = 50;
    var __textBoxInputNodeValue = null;
    var __textBoxTimer = null;
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
            __resource.Args["ListBox"] = (resource["ListBox"] != null ? resource["ListBox"] : null);
            __resource.Args["Spinner"] = (resource["Spinner"] != null ? resource["Spinner"] : null);
            __resource.Args["TextBox"] = (resource["TextBox"] != null ? resource["TextBox"] : null);
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
    this.CommitState = true;
    this.ContainsFocus = false;
    this.Created = false;
    this.Cursor = "default";
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.Left = 0;
    this.LocalePath = __System.Convert._IsNullToDefault(locale, __System.BasePath + "resources/ui/" + __pageName + "/" + __System.Locale + "/")
    this.Location = { X: null, Y: null };
    this.MousePosition = { X: null, Y: null };
    this.Name = null;
    this.OnAfterLoad = null;
    this.OnAfterSearch = null;
    this.OnBeforeLoad = null;
    this.OnBeforeSearch = null;
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
    this.OnSearch = null;
    this.OnSelectionCommitted = null;
    this.SelectedIndex = -1;
    this.SelectedItem = null;
    this.SelectedValue = null;
    this.OnSizeChanged = null;
    this.PageID = null;
    this.Parent = null;
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.TabIndex = null;
    this.Tag = null;
    this.Text = null;
    this.Top = 0;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
        
    this.ListBox = new __System.Controls.UI.ListBox(__resource.Args["ListBox"]);
    this.ListBox.Parent = this;
    
    this.ListBox.OnClick = function(/*Object*/ control)
    {
        if (control.SelectedIndex != -1)
        {
            ___HideListBox(true);
            
            __this.SelectedIndex = control.SelectedIndex;
            __this.SelectedItem = control.SelectedItem;
            __this.SelectedValue = control.SelectedValue;
            
            if (typeof __this.OnSelectionCommitted == "function")
            {
                __this.OnSelectionCommitted(__this);
            }
        }
    }
    
    this.ListBox.OnItemMouseHover = function(/*Object*/ control, /*Event*/ evt, /*Integer*/ index)
    {
        if (!__keyDown)
        {
            if (control.SelectedIndex != -1)
            {
                __this.ListBox.Focus();
                ___SelectItem(control.SelectedIndex, false);
            }
            
            ___SelectItem(index, true);
        }
    }
    
    this.ListBox.OnItemMouseLeave = function(/*Object*/ control, /*Event*/ evt, /*Integer*/ index)
    {
        if (!__keyDown)
        {
            ___SelectItem(index, false);
        }
    }
    
    this.ListBox.OnKeyDown = function(/*Object*/ control, /*Event*/ evt)
    {
        __keyDown = true;
        
        if (__selectedIndex != -1 && (evt.keyCode == 38 || evt.keyCode == 40))
        {
            ___SelectItem(__selectedIndex, false);
            __selectedIndex = -1;
        }
    }
    
    this.ListBox.OnKeyUp = function(/*Object*/ control, /*Event*/ evt)
    {
        __keyDown = false;
    }
    
    this.ListBox.OnLostFocus = function(/*Object*/ control, /*Event*/ evt, /*Integer*/ index)
    {
        if (!__this.ContainsFocus && !__this.TextBox.ContainsFocus)
        {
            ___HideDropDown();
        }
    }
    
    if (!__resource.Args["ListBox"])
    {
        __resource.Children.push(this.ListBox);
    }
    
    this.Spinner = new __System.Controls.UI.Spinner(__resource.Args["Spinner"]);
    
    this.TextBox = new __System.Controls.UI.TextBox(__resource.Args["TextBox"]);
    this.TextBox.Parent = this;
    
    this.TextBox.OnGotFocus = function(/*Object*/ control)
    {
        if (control.Focused)
        {
            if (__droppedDown)
            {
                ___HideListBox(true);
            }
            else if (!__droppedDown && !__retrieving)
            {
                __this._ResetTextBox();
            }
        }
    }
    
    this.TextBox.OnLostFocus = function(/*Object*/ control)
    {
        if (!control.Focused)
        {
            if (!__retrieving)
            {
                if (!__droppedDown && __textBoxInputNode.value == "")
                {
                    __this._ResetTextBox(true);
                }
            }
        }
    }
    
    this.TextBox.OnMouseEnter = function(/*Object*/ control)
    {
        clearTimeout(__textBoxTimer);
        __textBoxTimer = null;
    }
    
    this.TextBox.OnMouseLeave = function(/*Object*/ control)
    {
        if (__textBoxInputNode.value == "")
        {
            __this._ResetTextBox();
        }
    }
    
    this.TextBox.OnMouseDown = function(/*Object*/ control)
    {
        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown) && (__droppedDown || __statusDroppedDown))
        {
            ___HideListBox(true);
        }
        
        if (control.Focused && !__textBoxChanged)
        {
            ___ClearTextBox();
        }
    }
    
    this.TextBox.OnMouseWheel = function(/*Object*/ control, /*Event*/ evt)
    {
        if (__droppedDown)
        {
            __this.ListBox._EVENTS.MouseWheel(evt, true);
        }
    }
    
    this.TextBox.OnKeyUp = function(/*Object*/ control, /*Event*/ evt)
    {
        if (control.Focused)
        {
            switch (evt.keyCode)
            {
                case 27:
                    if (__droppedDown)
                    {
                        ___HideListBox();
                    }
                    break;
                default:
                    if (__textBoxInputNode.value == "")
                    {
                        ___HideListBox();
                    }
            }
            
            if (__textBoxInputNodeValue != __textBoxInputNode.value)
            {
                __textBoxChanged = true;
                ___SetSearchImage(false);
            }
            else if (__textBoxChanged == null)
            {
                __textBoxChanged = false;
            }
            
            if (__droppedDown)
            {
                __this.ListBox._EVENTS.KeyUp(evt, true);
            }
        }
        
        __keyDown = false;
    }
    
    this.TextBox.OnKeyDown = function(/*Object*/ control, /*Event*/ evt)
    {
        __keyDown = true;
        
        if (control.Focused)
        {
            __System.Controls.DOM.ApplyFontStyle(__textBoxInputNode, __this.Font);
            
            if (!__droppedDown && __textBoxChanged != null && !__textBoxChanged)
            {
                ___ClearTextBox();
                __textBoxChanged = null;
            }
            
            if (evt.keyCode == 13)
            {
                ___Search(true);
            }
            
            if (__droppedDown)
            {
                __this.ListBox._EVENTS.KeyDown(evt, true);
            }
            
            __textBoxInputNodeValue = __textBoxInputNode.value;
        }
    }
    
    if (!__resource.Args["TextBox"])
    {
        __resource.Children.push(this.TextBox);
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
                    
                    left = __System.Convert._IsNullToDefault(__this.Location.X, left);
                    top = __System.Convert._IsNullToDefault(__this.Location.Y, top);
                    
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
    
    this.Locale =
    {
        get: function()
        {
            return (__localeLang != null && __localization[__localeLang.toLowerCase()] != null ? __localeLang : (__localization["default"] != null ? "default" : (__localization[__System.Locale.toLowerCase()] != null ? __System.Locale : "")));
        },
        set: function(/*String*/ lang, /*String*/ path, /*Object*/ obj)
        {
            if (path != null)
            {
                __this.LocalePath = path;
                ___LoadResourceXml(__this.LocalePath, __locale, __this, ___ParseLocaleXmlCallback);
            }
            
            if (obj != null)
            {
                __localization = obj;
            }
            
            if (lang != null)
            {
                if (__localization[lang.toLowerCase()] != null)
                {
                    __localeLang = lang;
                }
            }
        }
    }
    
    this.Parsing =
    {
        get: function()
        {
            return __resource.Parsing || __locale.Parsing || ___IsChildrenResourceParsing(__resource);
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
    
    function ___ClearTextBox()
    {
        __textBoxInputNode.value = __textBoxInputNodeValue = "";
        __textBoxChanged = false;
    }
    
    function ___HideDropDown()
    {
        __this.Spinner.Remove();
        __System.Controls.DOM.SetVisibility(__statusNode, false);
        __this.ListBox.Show(false);
        
        __droppedDown = false;
        __statusDroppedDown = false;
    }
    
    function ___HideListBox(/*Boolean*/ bypassClear)
    {
        ___HideDropDown();
        ___SetSearchImage(false);
        
        if (!bypassClear)
        {
            ___ClearTextBox();
        }
        
        __retrieving = false;
        __textBoxChanged = bypassClear;
    }
    
    function ___InsertControl()
    {
        __this.TextBox.BackColor = __this.BackColor;
        __this.TextBox.BorderColor = __this.BorderColor;
        __this.TextBox.BorderSize = __this.BorderSize;
        __this.TextBox.BorderStyle = __this.BorderStyle;
        __this.TextBox.Bottom = __this.Bottom;
        __this.TextBox.ForeColor = __this.ForeColor;
        __this.TextBox.Font = __this.Font;
        __this.TextBox.Height = __this.Height;
        __this.TextBox.Left = __this.Left;
        __this.TextBox.PageID = __textBoxNode.id;
        __this.TextBox.Right = __this.Right;
        __this.TextBox.RightToLeft = __this.RightToLeft;
        __this.TextBox.Top = __this.Top;
        __this.TextBox.Width = __this.Width;
        __this.TextBox.Load();
        
        if (__this.TextBox.Height != __this.Height)
        {
            __this.Height = __this.TextBox.Height;
            __pageNode.style.height = __this.Height;
        }
        
        var n = __System.Convert._IsNullToDefault(__this.BorderSize, 0);
        
        __textBoxInputNode = document.getElementById(__this.TextBox.ControlName.get() + "$TextBox");
        
        with (__textBoxInputNode)
        {
            className = __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "TextBox", "ClassName"), className);
            style.width = __this.Width - __this.Left - (__this.RightToLeft ? 0 : __resources["Search"].Width) - __this.Right - (n * 2);

            title = __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "TextBox", "ToolTip"), "");
        }
        
        __System.Controls.DOM.ApplyCssText(__textBoxInputNode, ___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "TextBox", "Style"));
        
        __textBoxPositionNode = document.getElementById(__this.TextBox.ControlName.get() + "$TextBoxPosition");
        
        __searchButtonNode = __System.Controls.DOM.Append({
                                                            ID: __this.PageID + "$SearchButton",
                                                            Visibility: false,
                                                            Parent: __textBoxNode.id
                                                          });
        
        with (__searchButtonNode)
        {
            style.left = (__this.RightToLeft ? __this.Left + n : __this.Width - __this.Right - n - __resources["Search"].Width);
            style.top = __this.Top + n;
            
            innerHTML = '<a id="' + __controlName + '$SearchButton$Anchor" href="javascript:void(0)"><img id="' + __controlName + '$SearchButton$Image" src="' + __resources["Search"].Build(0, __this.RightToLeft) + '" unselectable="on" style="border:none" /></a>';
        }
        
        __searchButtonNodeImage = document.getElementById(__controlName + "$SearchButton$Image");
        
        with (document.getElementById(__controlName + "$SearchButton$Anchor"))
        {
            style.cursor = "default";
            
            onclick = function()
            {
                ___Search();
            }
            
            onfocus = function()
            {
                __System.Controls.DOM.SetImageSrc(__searchButtonNodeImage, (!__this.CommitState && !__searchSent ? __searchButtonNodeImage.src : __resources[(__searchSent ? "Clear" : "Search")].Build(2, __this.RightToLeft)));
            }
            
            onfocusout = function()
            {
                __System.Controls.DOM.SetImageSrc(__searchButtonNodeImage, (!__this.CommitState && !__searchSent ? __searchButtonNodeImage.src : __resources[(__searchSent ? "Clear" : "Search")].Build(1, __this.RightToLeft)));
            }
        }
        
        with (__searchButtonNodeImage)
        {
            style.width = __resources["Search"].Width;
            style.height = __resources["Search"].Height;
            
            onmouseenter = function()
            {
                if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
                {
                    __System.Controls.DOM.SetImageSrc(this, (!__this.CommitState && !__searchSent ? this.src : __resources[(__searchSent ? "Clear" : "Search")].Build(2, __this.RightToLeft)));
                }
            }
            
            onmouseleave = function()
            {
                if (__textBoxInputNode.value == "")
                {
                    __textBoxTimer = setTimeout(__controlName + "._ResetTextBox()", __textBoxDelay);
                }
                
                ___RemoveEventMouseClick(__this);
                
                __System.Controls.DOM.SetImageSrc(this, (!__this.CommitState && !__searchSent ? this.src : __resources[(__searchSent ? "Clear" : "Search")].Build(1, __this.RightToLeft)));
            }
            
            onmousedown = function()
            {
                if (___TryEventMouseClick(__this))
                {
                    __System.Controls.DOM.SetImageSrc(this, __resources[(__searchSent ? "Clear" : "Search")].Build(3, __this.RightToLeft));
                }
            }
            
            onmouseup = function()
            {
                if (__System.Threading.Monitor._Current(__System.Controls.EventType.MouseDown) == __this)
                {
                    __System.Controls.DOM.SetImageSrc(this, __resources[(__searchSent ? "Clear" : "Search")].Build(1, __this.RightToLeft));
                }
            }
            
            alt = __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "SearchButton", "ToolTip"), "");
        }
        
        __this._ResetTextBox();
    }
    
    function ___RemoveEventFocus()
    {
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyPress, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyDown, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyUp, __this);
        
        __this.ContainsFocus = false;
    }
        
    function ___Search(/*Boolean*/ fromKeyboard)
    {
        __this.TextBox._HideDropDown();
        
        if (!__textBoxChanged || __retrieving)
        {
            ___HideListBox();
            ___SetSearchImage(false, fromKeyboard);
            
            __textBoxInputNode.focus();
        }
        else if (__textBoxChanged && typeof __this.OnSearch == "function")
        {
            if (__textBoxInputNode.value != "")
            {
                if (typeof __this.OnBeforeSearch == "function")
                {
                    __this.OnBeforeSearch(__this, __textBoxInputNode.value);
                }
                
                __this.ListBox.Items.Clear();
                
                ___SetSearchImage(true, fromKeyboard);
                
                with (__statusNode)
                {
                    var p = __System.Controls.DOM.Bounds(__textBoxPositionNode, true);
                    
                    style.left = p.X;
                    style.top = p.Y + p.Height;
                    style.width = p.Width;
                    style.color = __System.Convert._IsNullToDefault(__this.ForeColor, "");
                    style.backgroundColor = __System.Convert._IsNullToDefault(__this.BackColor, "");
                    style.border = (__this.BorderStyle != null ? __this.BorderStyle + (__this.BorderSize != null ? " " + __this.BorderSize + "px" : "") + (__this.BorderColor != null ? " " + __this.BorderColor : "") : "");
                    style.cursor = __System.Convert._IsNullToDefault(__this.Cursor, "");
                    
                    innerHTML = '<table cellspacing="0" cellpadding="0" border="0"' + (__this.ForeColor != null ? ' style="color:' + __this.ForeColor + '"' : '') + '>' +
                                '<tr>' +
                                '<td id="' + __controlName + '$Spinner" unselectable="on"></td>' +
                                '<td id="' + __controlName + '$Status" unselectable="on">' + __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "SearchBoxStatus", "Text"), "") + '</td>' +
                                '</tr>' +
                                '</table>';
                    
                    dir = (__this.RightToLeft ? "rtl" : "");
                    
                    __System.Controls.DOM.ApplyFontStyle(__controlName + "$Status", __this.Font);
                    __System.Controls.DOM.ApplyCssText(__controlName + "$Status", ___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "SearchBoxStatus", "Style"), __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "SearchBoxStatus", "ClassName"), null));
                    
                    __this.Spinner.PageID = __controlName + "$Spinner";
                    __this.Spinner.Load();
                }
                
                __System.Controls.DOM.SetVisibility(__statusNode, true);
                
                __textBoxChanged = false;
                __statusDroppedDown = true;
                __retrieving = true;
                
                __this.OnSearch(__this, __textBoxInputNode.value);
                
                __this.Spinner.Remove();
                
                if (__this.ListBox.Items.Count > 0)
                {
                    __System.Controls.DOM.SetVisibility(__statusNode, false);
                    
                    with (__statusNode.style)
                    {
                        __this.ListBox.Location = { X: parseInt(left), Y: parseInt(top) };
                        __this.ListBox.Width = parseInt(width);
                    }
                    
                    __this.ListBox.BackColor = __this.BackColor;
                    __this.ListBox.BorderColor = __this.BorderColor;
                    __this.ListBox.BorderSize = __this.BorderSize;
                    __this.ListBox.BorderStyle = __this.BorderStyle;
                    __this.ListBox.Font = __this.Font;
                    __this.ListBox.ForeColor = __this.ForeColor;
                    __this.ListBox.ZIndex = __this.ZIndex;
                    __this.ListBox.RightToLeft = __this.RightToLeft;
                    __this.ListBox.SelectionMode = __System.Controls.UI.Components.SelectionMode.One;
                    __this.ListBox.Load();
                    
                    __statusDroppedDown = false;
                    __droppedDown = true;
                }
                else
                {
                    __statusNode.innerHTML = '<div id="' + __controlName + '$NoResultsFound" unselectable="on">' + __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "NoResultsFound", "Text"), "") + '</div>';
                    
                    __System.Controls.DOM.ApplyFontStyle(__controlName + "$NoResultsFound", __this.Font);
                    __System.Controls.DOM.ApplyCssText(__controlName + "$NoResultsFound", ___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "NoResultsFound", "Style"), __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "NoResultsFound", "ClassName"), null));
                }
                
                __retrieving = false;
                
                if (typeof __this.OnAfterSearch == "function")
                {
                    __this.OnAfterSearch(__this, __textBoxInputNode.value);
                }
            }
            else
            {
                __this._ResetTextBox();
            }
        }
    }
    
    function ___SelectItem(/*Integer*/ index, /*Boolean*/ selectItem)
    {
        if (index >= 0 && index < __this.ListBox.Items.Count)
        {
            var controlName = __this.ListBox.ControlName.get();
            var resources = __this.ListBox.Resources.get();
            
            document.getElementById(controlName + "$Item$Background$" + index).style.background = "url(" + (selectItem ? resources["SelectedItemBg"].Build() : "") + ")";
            document.getElementById(controlName + "$Item$Left$" + index).style.background = "url(" + (selectItem ? resources["SelectedItemLeft"].Build() : "") + ")";
            document.getElementById(controlName + "$Item$Right$" + index).style.background = "url(" + (selectItem ? resources["SelectedItemRight"].Build() : "") + ")";
            
            if (selectItem)
            {
                __selectedIndex = index;
            }
            
            __this.ListBox._SetFocus(index);
        }
    }
    
    function ___SetSearchImage(/*Boolean*/ submitSent, /*Boolean*/ fromKeyboard)
    {
        __searchSent = submitSent;
        __System.Controls.DOM.SetImageSrc(__searchButtonNodeImage, __resources[(__searchSent ? "Clear" : "Search")].Build((submitSent && fromKeyboard ? 0 : 1), __this.RightToLeft), __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], (submitSent ? "ClearButton" : "SearchButton"), "ToolTip"), ""));
    }
    
    function ___TryEventFocus()
    {
        if (__System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyPress, __this) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyDown, __this) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyUp, __this))
        {
            __this.ContainsFocus = true;
            
            return true;
        }
        else
        {
            ___RemoveEventFocus();
            
            return false;
        }
    }
    
    this._ResetTextBox = function(/*Boolean*/ resetCaret, /*String*/ text)
    {
        if (this.Font != null)
        {
            var o = this.Font.Clone();
            o.Italic = true;
            
            __System.Controls.DOM.ApplyFontStyle(__textBoxInputNode, o);
        }
        
        __textBoxInputNode.value = __System.Convert._IsNullToDefault(text, __System.Convert._IsNullToDefault(___TryObjectProperty(__localization[__this.Locale.get().toLowerCase()], "TextBox", "Text"), ""));
        
        if (!resetCaret)
        {
            this.TextBox.SelectionStart.set((this.RightToLeft ? __textBoxInputNode.value.length : 0));
        }
        
        __textBoxChanged = false;
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
            
            __this.TextBox.Show(__visible);
            __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            __System.Controls.DOM.SetVisibility(__searchButtonNode, __visible);
            
            if (!__visible)
            {
                ___RemoveEventFocus();
                __System.Controls.DOM.SetVisibility(__statusNode, __visible);
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
        
        if (___LoadResourceXml(this.LocalePath, __locale, this, ___ParseLocaleXmlCallback) && ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback) && !bypassLoad)
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
                            
                            __statusNode = __System.Controls.DOM.Append({
                                                                          ID: this.PageID + "$Status",
                                                                          Visibility: false
                                                                        });
                            
                            __textBoxNode = __System.Controls.DOM.Append({
                                                                           ID: this.PageID + "$TextBox",
                                                                           Position: "relative",
                                                                           Visibility: false,
                                                                           Parent: __pageNode
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
                    ___RemoveEventMouseClick(__this);
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
                    
                    if (typeof __this.OnKeyUp == "function")
                    {
                        __this.OnKeyUp(__this, evt);
                    }
                }
            }
        }
    }
    
    this.Locale.set(null, this.LocalePath);
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);

    if (__resource.Args["ListBox"])
    {
        __resource.Children.push(this.ListBox);
    }
    
    if (__resource.Args["Spinner"])
    {
        __resource.Children.push(this.Spinner);
    }
    
    if (__resource.Args["TextBox"])
    {
        __resource.Children.push(this.TextBox);
    }
    
    __System.Controls.Event.Add(this, __System.Controls.EventType.FocusOut);
}

if (typeof SearchBox == "undefined")
{
    SearchBox = __System.Controls.UI.SearchBox;
}

__System.Import("System.Controls.UI.SearchBox", true);
