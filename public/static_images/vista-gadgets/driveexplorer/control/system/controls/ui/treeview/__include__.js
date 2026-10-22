////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.ScrollBar");
__System.Import("System.Controls.UI.Components.ImageList");
__System.Import("System.Controls.UI.Components.TreeNode");

__System.Controls.UI.TreeView = function(/*String*/ resource)
{
    var __pageName = "TreeView";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __beforeSelectTreeNode = null;
    var __contentNode = null;
    var __plusMinusNode = null;
    var __fadeCurrent = 100;
    var __fadeIncrement = 5;
    var __fadeMinOpacity = 0;
    var __fadeMaxOpacity = 100;
    var __fadeInSpeed = 5;
    var __fadeOutSpeed = 60;
    var __fadeTimer = null;
    var __focusContainer = false;
    var __resources = [];
    var __innerOffset = null;
    var __keyboardSpeed = 25;
    var __hasScrolled = false;
    var __nodesVisible = null;
    var __origPosition = null;
    var __origOverflow = null;
    var __resource = { Args: [], Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __selectNodeNonFocus = false;
    var __updating = false;
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
    this.BorderColor = null;
    this.BorderSize = 1;
    this.BorderStyle = null;
    this.Bottom = 0;
    this.ContainsFocus = false;
    this.CheckBoxes = false;
    this.Created = false;
    this.Cursor = "default";
    this.Font = null;
    this.ForeColor = null;
    this.FullRowSelect = false;
    this.Height = null;
    this.HideSelection = false;
    this.ImageIndex = -1;
    this.ImageKey = null;
    this.ImageList = new __System.Controls.UI.Components.ImageList();
    this.Indent = null;
    this.Left = 0;
    this.Location = { X: null, Y: null };
    this.Name = null;
    this.Nodes = new __System.Controls.UI.Components.TreeNodeCollection();
    this.OnAfterCheck = null;
    this.OnAfterCollapse = null;
    this.OnAfterExpand = null;
    this.OnAfterLoad = null;
    this.OnAfterSelect = null;
    this.OnBeforeCheck = null;
    this.OnBeforeCollapse = null;
    this.OnBeforeExpand = null;
    this.OnBeforeLoad = null;
    this.OnBeforeSelect = null;
    this.OnGotFocus = null;
    this.OnLostFocus = null;
    this.OnMouseDown = null;
    this.OnMouseUp = null;
    this.OnMouseEnter = null;
    this.OnMouseHover = null;
    this.OnMouseLeave = null;
    this.OnMove = null;
    this.OnNodeMouseClick = null;
    this.OnNodeMouseDoubleClick = null;
    this.OnNodeMouseEnter = null;
    this.OnNodeMouseHover = null;
    this.OnNodeMouseLeave = null;
    this.OnSizeChanged = null;
    this.MousePosition = { X: null, Y: null };
    this.PageID = null;
    this.Parent = null;
    this.PathSeparator = "\\";
    this.ResourcePath = __System.Convert._IsNullToDefault(__resource.Args[__pageName], __System.BasePath + "resources/ui/" + __pageName + "/");
    this.Right = 0;
    this.RightToLeft = false;
    this.RightToLeftLayout = false;
    this.Scrollable = true;
    this.SelectedImageIndex = -1;
    this.SelectedImageKey = null;
    this.SelectedNode = null;
    this.ShowNodeToolTips = true;
    this.ShowPlusMinus = true;
    this.Sorted = false;
    this.SystemScrollBar = false;
    this.Tag = null;
    this.TabIndex = null;
    this.Text = null;
    this.TextPadding = 0;
    this.Top = 0;
    this.TopNode = null;
    this.TreeViewNodeSorter = null;
    this.Visible = false;
    this.Width = null;
    this.ZIndex = null;
    
    this.ScrollBar = new __System.Controls.UI.ScrollBar(__resource.Args["ScrollBar"]);
    this.ScrollBar.Parent = this;
    
    this.ScrollBar.OnScroll = function()
    {
        if (__plusMinusNode != null)
        {
            __System.Controls.DOM.SetVisibility(__plusMinusNode, false);
            __System.Controls.DOM.SetOpacity(__plusMinusNode.controlName + "$PlusMinus", __fadeMaxOpacity);
        }
    }
    
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
                if (__this.Scrollable && !__this.SystemScrollBar)
                {
                    if (__this.SelectedNode != null)
                    {
                        __this.SelectedNode.TextDOM.style.width = "";
                    }
                    
                    __this.ScrollBar.Bounds.set(__this.Bounds.get());
                    
                    if (__this.SelectedNode != null)
                    {
                        ___SetNodeWidth(__this.SelectedNode);
                    }
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
                with (__contentNode.style)
                {
                    width = (__this.Scrollable && __this.SystemScrollBar && __this.Width != null ? (__this.Width - (__this.BorderStyle != null ? __this.BorderSize * 2 : 0)) : "");
                    height = (__this.Scrollable && __this.SystemScrollBar && __this.Width != null ? (__this.Height - (__this.BorderStyle != null ? __this.BorderSize * 2 : 0)) : "");
                }
                
                if (!_calculateSize)
                {
                    if (__this.Scrollable && !__this.SystemScrollBar)
                    {
                        if (__this.SelectedNode != null)
                        {
                            __this.SelectedNode.TextDOM.style.width = "";
                        }
                        
                        __this.ScrollBar.Size.set(__this.Width, __this.Height);
                        
                        if (__this.SelectedNode != null)
                        {
                            ___SetNodeWidth(__this.SelectedNode);
                        }
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
    
    function ___CreateNodeIndex(/*String*/ controlName)
    {
        return controlName.substring(__controlName.length + 1).split("$");
    }
    
    function ___FadePlusMinus(/*Integer*/ direction)
    {
        clearTimeout(__fadeTimer);
        
        if (direction == -1)
        {
            __nodesVisible = ___FindVisibleNodes(__this.Nodes, ___GetVisibleRegion(), true);
        }
        
        if (__nodesVisible != null)
        {
            __this._ProcessFadePlusMinus(direction);
        }
    }
    
    function ___FindNode(/*Array*/ nodeIndex)
    {
        var s = "";
        
        for (var i = 0; i < nodeIndex.length; i++)
        {
            s += ".Nodes[" + nodeIndex[i] + "]";
        }
        
        try
        {
            var o = eval("__this" + s);
            return o;
        }
        catch (e)
        {
            return null;
        }
    }
    
    function ___FindNodeByCoordinates(/*TreeNodeCollection*/ nodes, /*Point*/ point)
    {
        var o = null;
        
        for (var i = 0; i < nodes.Count; i++)
        {
            point.Y -= __resources["SelectedItemBg"].Height;
            
            if (point.Y <= 0)
            {
                var node = nodes[i];
                var bounds = node.Bounds.get();
                
                if (point.X != null)
                {
                    node = (bounds.X != null && point.X >= bounds.X && point.X <= bounds.X + bounds.Width ? node : null);
                }
                
                point.Y = null;
                return node;
            }
            
            if (nodes[i].IsExpanded)
            {
                o = ___FindNodeByCoordinates(nodes[i].Nodes, point);
                
                if (point.Y == null)
                {
                    return o;
                }
            }
        }
        
        return o;
    }
    
    function ___FindVisibleNodes(/*TreeNodeCollection*/ nodes, /*Bounds*/ dimension, /*Boolean*/ hasNodes, /*String*/ _controlNameArray)
    {
        if (_controlNameArray == null)
        {
            _controlNameArray = [];
            dimension.Y += __this.Top;
            dimension.Length = 0;
        }
        
        for (var i = 0; i < nodes.Count; i++)
        {
            dimension.Y -= __resources["SelectedItemBg"].Height;
            
            if (dimension.Y <= 0)
            {
                if (dimension.Length * __resources["SelectedItemBg"].Height <= dimension.Height)
                {
                    var x = (__this.RightToLeft ? __this.Right : __this.Left) + ((nodes[i].Level + 1) * __this.Indent);
                    
                    if (x >= dimension.X && x <= dimension.X + dimension.Width && (!hasNodes || (nodes[i].HasNodes || nodes[i].GetNodeCount() > 0)))
                    {
                        var controlName = nodes[i].ControlName.get();
                        
                        if (controlName != null)
                        {
                            _controlNameArray.push(controlName);
                        }
                    }
                    
                    dimension.Length++;
                }
                else
                {
                    dimension.Y = null;
                    return _controlNameArray;
                }
            }
            
            if (nodes[i].IsExpanded)
            {
                ___FindVisibleNodes(nodes[i].Nodes, dimension, hasNodes, _controlNameArray);
                
                if (dimension.Y == null)
                {
                    return _controlNameArray;
                }
            }
        }
        
        return _controlNameArray;
    }
    
    function ___GetImageIndex(/*TreeNode*/ node)
    {
        if (node != null)
        {
            if (node.ImageKey != null || node.ImageIndex != -1)
            {
                return (node.IsSelected && (node.SelectedImageKey != null || node.SelectedImageIndex) ? (node.SelectedImageKey != null ? node.SelectedImageKey : node.SelectedImageIndex) : (node.ImageKey != null ? node.ImageKey : node.ImageIndex));
            }
            else
            {
                return (node.IsSelected && (__this.SelectedImageKey != null || __this.SelectedImageIndex) ? (__this.SelectedImageKey != null ? __this.SelectedImageKey : __this.SelectedImageIndex) : (__this.ImageKey != null ? __this.ImageKey : __this.ImageIndex));
            }
        }
    }
    
    function ___GetNodeContent(/*TreeNode*/ node)
    {
        var controlName = (node.Parent != null ? node.Parent.ControlName.get() : __controlName) + "$" + node.Index;
        var imageIndex = (__this.CheckBoxes ? -1 : ___GetImageIndex(node));
        
        node.ControlName.set(controlName);
        
        return '<div id="' + controlName + '$TreeNode" unselectable="on" style="height:' + __resources["SelectedItemBg"].Height + 'px;' + (node.BackColor != null ? "background-color:" + node.BackColor + ";" : "") + 'white-space:nowrap">' +
               '<table id="' + controlName + '$Root" cellspacing="0" cellpadding="0" border="0" onclick="' + __controlName + '._OnNodeMouseClick(\'' + controlName + '\')" ondblclick="' + __controlName + '._OnNodeMouseDoubleClick(\'' + controlName + '\')">' +
               '<tr>' +
               '<td unselectable="on" style="width:' + (!__this.ShowPlusMinus && node.Level == 0 ? 0 : __this.Indent) + 'px;font-size:0px;text-align:' + (__this.RightToLeft ? "left" : "right") + '" nowrap>' +
               (node.HasNodes || node.GetNodeCount() > 0 ? '<div style="width:' + (!__this.ShowPlusMinus && node.Level == 0 ? 0 : __this.Indent) + 'px;overflow:hidden"><img id="' + controlName + '$PlusMinus" src="' + __resources[(node.IsExpanded ? "Plus" : "Minus")].Build(0, __this.RightToLeft) + '" unselectable="on" onmouseenter="' + __controlName + '._SetPlusMinus(\'' + controlName + '\', true)" onmouseleave="' + __controlName + '._SetPlusMinus(\'' + controlName + '\', false)" onmousedown="' + __controlName + '._Toggle(\'' + controlName + '\');' + __controlName + '._SetPlusMinus(\'' + controlName + '\', true);' + __controlName + '.Focus();__System.Controls.DOM.CancelEvent(event)" /></div>' : '&nbsp;') +
               '</td>' +
               '<td unselectable="on" onmouseenter="' + __controlName + '._OnNodeMouseEnter(\'' + controlName + '\', this)" onmousemove="' + __controlName + '._OnNodeMouseHover(\'' + controlName + '\', this)" onmouseleave="' + __controlName + '._OnNodeMouseLeave(\'' + controlName + '\', this)" onmousedown="' + __controlName + '._OnBeforeSelect(\'' + controlName + '\');__System.Controls.DOM.CancelEvent(event)" onmouseup="' + __controlName + '._' + (!__this.ShowPlusMinus ? "Toggle" : "Expand") + '(\'' + controlName + '\', true)">' +
               '<table dir="ltr" cellspacing="0" cellpadding="0" border="0">' +
               '<tr>' +
               '<td id="' + controlName + '$Text$Left" style="width:' + __resources["SelectedItemLeft"].Width + 'px;white-space:nowrap" nowrap></td>' +
               '<td id="' + controlName + '$Text$Background" style="height:' + __resources["SelectedItemBg"].Height + 'px;white-space:nowrap" nowrap>' +
               '<table' + (__this.RightToLeft ? ' dir="rtl"' : '') + ' cellspacing="0" cellpadding="0" border="0">' +
               '<tr>' +
               (imageIndex != -1 || __this.CheckBoxes ? '<td id="' + controlName + '$Text$Image" unselectable="on">' + (imageIndex != -1 ? '<img id="' + controlName + '$Image" src="' + __this.ImageList.Images[imageIndex] + '" unselectable="on" />' : '<div style="height:' + __resources["SelectedItemBg"].Height + 'px;overflow:hidden"><input id="' + controlName + '$CheckBox" type="checkbox" onmousedown="__System.Controls.DOM.CancelEvent(event)" onclick="' + __controlName + '._Check(\'' + controlName + '\', this.checked)"' + (node.Checked ? " checked" : "") + ' /></div>') + '</td>' : '') +
               (__this.TextPadding > 0 ? '<td style="width:' + __this.TextPadding + 'px;white-space:nowrap" nowrap></td>' : '') +
               '<td id="' + controlName + '$Text$DOM" unselectable="on" style="height:' + __resources["SelectedItemBg"].Height + 'px;' + (node.ForeColor != null ? "color:" + node.ForeColor + ";" : "") + '" nowrap>' + node.Text + '</td>' +
               (__this.TextPadding > 0 ? '<td style="width:' + __this.TextPadding + 'px;white-space:nowrap" nowrap></td>' : '') +
               '</tr>' +
               '</table>' +
               '</td>' +
               '<td id="' + controlName + '$Text$Right" unselectable="on" style="width:' + __resources["SelectedItemRight"].Width + 'px;white-space:nowrap" nowrap></td>' +
               '</tr>' +
               '</table>' +
               '</td>' +
               '</tr>' +
               '</table>' +
               '<div id="' + controlName + '$Nodes" unselectable="on" style="padding-' + (__this.RightToLeft ? "right" : "left") + ':' + (!__this.ShowPlusMinus && node.Level == 0 ? 0 : __this.Indent) + 'px;display:none"></div>' +
               '</div>';
    }
    
    function ___GetVisibleRegion()
    {
        return { X: (__this.RightToLeft ? (__this.ScrollBar.VScrollBar.Visible ? (__this.ScrollBar._OffsetWidth() - __this.ScrollBar._ScrollBarWidth()) - Math.abs(__this.ScrollBar._ScrollLeft()) : 0) : Math.abs(__this.ScrollBar._ScrollLeft())), Y: Math.abs(__this.ScrollBar._ScrollTop()), Width: __pageNode.offsetWidth - __innerOffset - (__this.ScrollBar.VScrollBar.Visible ? __this.ScrollBar.VScrollBar.Width : 0), Height: __pageNode.offsetHeight - __innerOffset - (__this.ScrollBar.HScrollBar.Visible ? __this.ScrollBar.HScrollBar.Height : 0) };
    }
    
    function ___NextExpandedNode(/*TreeNode*/ node)
    {
        if (node.IsExpanded && node.Nodes.Count > 0)
        {
            return node.Nodes[0];
        }
        else
        {
            while (node != null)
            {
                var o = node.NextNode.get();
                
                if (o != null)
                {
                    return o;
                }
                
                node = node.Parent;
            }
            
            return null;
        }
    }
    
    function ___PreviousExpandedNode(/*TreeNode*/ node)
    {
        while (node != null)
        {
            var o = node.PrevNode.get();
            
            if (o != null)
            {
                while (o.IsExpanded && o.Nodes.Count > 0)
                {
                    o = o.Nodes[o.Nodes.Count - 1];
                }
                
                return o;
            }
            
            return node.Parent;
        }
        
        return null;
    }
    
    function ___RecurseNodesByIndex(/*TreeNodeCollection*/ nodes, /*TreeNode*/ node)
    {
        var result = 0;
        
        for (var i = 0; i < nodes.Count; i++)
        {
            result++;
            
            if (nodes[i] == node)
            {
                return -result;
            }
            else
            {
                if (nodes[i].IsExpanded)
                {
                    var n = ___RecurseNodesByIndex(nodes[i].Nodes, node);
                    
                    if (n >= 0)
                    {
                        result += n;
                    }
                    else
                    {
                        return n - result;
                    }
                }
            }
        }
        
        return result;
    }
    
    function ___RemoveEventFocus()
    {
        __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseWheel, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyDown, __this);
        __System.Threading.Monitor.Exit(__System.Controls.EventType.KeyUp, __this);
        
        __this.ContainsFocus = false;
    }
    
    function ___Select(/*TreeNode*/ node, /*Boolean*/ selectItem, /*Boolean*/ state, /*Boolean*/ useHover)
    {
        var controlName = node.ControlName.get();
        
        if (controlName != null)
        {
            try
            {
                document.getElementById(controlName + "$Text$Left").style.background = "url(" + (selectItem ? __resources[state + "ItemLeft"].Build((useHover ? 1 : 0)) : "") + ")";
                document.getElementById(controlName + "$Text$Background").style.background = "url(" + (selectItem ? __resources[state + "ItemBg"].Build((useHover ? 1 : 0)) : "") + ")";
                document.getElementById(controlName + "$Text$Right").style.background = "url(" + (selectItem ? __resources[state + "ItemRight"].Build((useHover ? 1 : 0)) : "") + ")";
            }
            catch (e)
            {
            }
        }
    }
    
    function ___SelectNode(/*TreeNode*/ node, /*Boolean*/ state, /*Boolean*/ useHover, /*Boolean*/ useFocus)
    {
        if (node != null)
        {
            ___SetNodeWidth(node);
            ___Select(node, true, state, useHover);
            
            if (useFocus)
            {
                __this.Focus();
            }
        }
    }
    
    function ___SetNodeTextDOM(/*TreeNode*/ node)
    {
        node.TextDOM = document.getElementById(node.ControlName.get() + "$Text$DOM");
    }
    
    function ___SetNodeWidth(/*TreeNode*/ node)
    {
        if (node != null)
        {
            if (node.TextDOM == null)
            {
                ___SetNodeTextDOM(node);
            }
            
            if (node.TextDOM != null)
            {
                var o = document.getElementById(node.ControlName.get() + "$Text$Image");
                node.TextDOM.style.width = (__this.FullRowSelect && !__this.SystemScrollBar ? (__this.ScrollBar.HScrollBar.Visible ? __contentNode.offsetWidth : __pageNode.offsetWidth - __innerOffset) - __this.Left - ((node.Level + 1) * __this.Indent) - __resources["SelectedItemLeft"].Width - (o != null ? o.offsetWidth : 0) - (__this.TextPadding * 2) - __resources["SelectedItemRight"].Width - __this.Right - (__this.ScrollBar.VScrollBar.Visible && !__this.ScrollBar.HScrollBar.Visible ? __this.ScrollBar.VScrollBar.Width : 0) : "");
            }
        }
    }
    
    function ___SortNodes(/*TreeNodeCollection*/ nodes, /*Comparer*/ predicate, /*Boolean*/ recurse)
    {
        var o = new __System.Controls.UI.Components.TreeNodeCollection();
        
        for (var i = 0; i < nodes.Count; i++)
        {
            if (recurse)
            {
                nodes[i].Nodes = ___SortNodes(nodes[i].Nodes);
            }
            
            for (var j = 0; j < o.Count; j++)
            {
                if (predicate.Compare(nodes[i], o[j]) == 1)
                {
                    o.Insert(Math.max(0, j - 1), nodes[i]);
                    break;
                }
            }
            
            if (o.Count <= i)
            {
                o.Add(nodes[i]);
            }
        }
        
        return o;
    }
    
    function ___TryEventFocus()
    {
        if (__System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyDown, __this) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.KeyUp, __this))
        {
            __System.Threading.Monitor.TryEnter(__System.Controls.EventType.MouseWheel, __this);
            __this.ContainsFocus = true;
            return true;
        }
        else
        {
            ___RemoveEventFocus();
            return false;
        }
    }
    
    function ___UnselectNode(/*TreeNode*/ node)
    {
        if (node != null)
        {
            if (node.TextDOM == null)
            {
                ___SetNodeTextDOM(node);
            }
            
            if (node.TextDOM != null)
            {
                node.TextDOM.style.width = "";
            }
            
            ___Select(node, false);
        }
    }
    
    this._Check = function(/*String*/ controlName, /*Boolean*/ checked)
    {
        var o = ___FindNode(___CreateNodeIndex(controlName));
        
        if (o != null)
        {
            if (typeof this.OnBeforeCheck == "function")
            {
                this.OnBeforeCheck(o);
            }
            
            o.Checked = checked;
            
            if (typeof this.OnAfterCheck == "function")
            {
                this.OnAfterCheck(o);
            }
        }
    }
    
    this._Draw = function(/*TreeNode*/ node)
    {
        if (node.Nodes.Count > 0)
        {
            clearTimeout(__fadeTimer);
            
            var b = (node == this);
            
            if (this.Sorted && this.TreeViewNodeSorter != null && this.TreeViewNodeSorter.Compare != null)
            {
                node.Nodes = ___SortNodes(node.Nodes, this.TreeViewNodeSorter);
            }
            
            this.BeginUpdate();
            
            var s = (b ? '<div id="' + __controlName + '$Content">' : '');
            
            for (var i = 0; i < node.Nodes.Count; i++)
            {
                node.Nodes[i].Index = i;
                node.Nodes[i].Level = (b ? 0 : node.Level + 1);
                node.Nodes[i].TreeView = this;
                
                if (!b)
                {
                    node.Nodes[i].Parent = node;
                }
                
                s += ___GetNodeContent(node.Nodes[i]);
            }
            
            s += (b ? '</div>' : '');
            
            if (b)
            {
                if (this.Scrollable && !this.SystemScrollBar)
                {
                    this.ScrollBar._Write(s, true);
                }
                else
                {
                    __pageNode.innerHTML = s;
                }
                
                __contentNode = document.getElementById(__controlName + "$Content");
                __innerOffset = (this.BorderStyle != null ? this.BorderSize * 2 : 0);
                
                with (__contentNode)
                {
                    style.width = (this.Scrollable && this.SystemScrollBar && this.Width != null ? this.Width - __innerOffset : "");
                    style.height = (this.Scrollable && this.SystemScrollBar && this.Height != null ? this.Height - __innerOffset : "");
                    style.padding =  this.Top + "px " + this.Right + "px " + this.Bottom + "px " + this.Left + "px";
                    style.overflow = (this.Scrollable && this.SystemScrollBar ? "auto" : "");
                }
            }
            else
            {
                document.getElementById(node.ControlName.get() + "$Nodes").innerHTML = s;
            }
            
            for (var i = 0; i < node.Nodes.Count; i++)
            {
                ___SetNodeTextDOM(node.Nodes[i]);
                __System.Controls.DOM.ApplyFontStyle(node.Nodes[i].TextDOM, (node.Nodes[i].NodeFont != null ? node.Nodes[i].NodeFont : this.Font));
                
                if (node.Nodes[i].IsExpanded)
                {
                    node.Nodes[i].Expand();
                }
            }
            
            this.EndUpdate();
            this.Refresh();
            
            if (b)
            {
                if (this.SelectedNode != null)
                {
                    if (this.ContainsFocus)
                    {
                        ___SelectNode(this.SelectedNode, "Selected");
                    }
                    else if (__selectNodeNonFocus)
                    {
                        ___Select(this.SelectedNode, true, "NonFocus", false);
                    }
                }
                
                if (this.Scrollable && !this.SystemScrollBar)
                {
                    __plusMinusNode = __System.Controls.DOM.Append({
                                                                     ID: __controlName + "$PlusMinus",
                                                                     Visibility: false,
                                                                     ZIndex: -1,
                                                                     Parent: __contentNode
                                                                   });
                }
                else
                {
                    __System.Controls.DOM.Remove(__plusMinusNode);
                }
                
                __fadeCurrent = __fadeMaxOpacity;
            }
        }
    }
    
    this._Expand = function(/*String*/ controlName)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            if (___TryEventMouseClick(__this))
            {
                if (node == __beforeSelectTreeNode)
                {
                    var b = node.IsExpanded;
                    
                    this.BeginUpdate();
                    
                    if (!b && typeof this.OnBeforeExpand == "function")
                    {
                        this.OnBeforeExpand(node);
                    }
                    
                    if (this.SelectedNode != null && this.SelectedNode != node)
                    {
                        this.SelectedNode.IsSelected = false;
                        
                        if (this.SelectedNode.Parent == node.Parent)
                        {
                            this.SelectedNode.Collapse();
                        }
                        else
                        {
                            this._SetImage(this.SelectedNode);
                        }
                        
                        ___UnselectNode(this.SelectedNode);
                    }
                    
                    node.IsSelected = true;
                    node.EnsureVisible(true);
                    node.Expand();
                    
                    this.SelectedNode = node;
                    
                    if (!b && typeof this.OnAfterExpand == "function")
                    {
                        this.OnAfterExpand(node);
                    }
                    
                    this.EndUpdate();
                    
                    if (!b)
                    {
                        this.Refresh();
                    }
                }
                else if (__beforeSelectTreeNode != null && __beforeSelectTreeNode != this.SelectedNode)
                {
                    ___UnselectNode(__beforeSelectTreeNode);
                }
                
                __beforeSelectTreeNode = null;
            }
            
            if (typeof this.OnAfterSelect == "function")
            {
                this.OnAfterSelect(node);
            }
        }
    }
    
    this._GetNodeLocation = function(/*TreeNode*/ node)
    {
        if (node != null)
        {
            return { X: (this.RightToLeft ? this.Right : this.Left) + (node.Level * this.Indent), Y: this.Top + ((Math.abs(___RecurseNodesByIndex(this.Nodes, node)) - 1) * __resources["SelectedItemBg"].Height) };
        }
    }
    
    this._IsNodeVisible = function(/*TreeNode*/ node)
    {
        if (node != null)
        {
            do
            {
                node = node.Parent;
                
                if (node != null && !node.IsExpanded)
                {
                    return false;
                }
            }
            while (node != null && node != this)
            
            return true;
        }
        
        return false;
    }
    
    this._MoveToNodeByDirection = function(/*Integer*/ direction, /*Boolean*/ useTimerRepeat)
    {
        __focusContainer = true;
        
        var o = (direction == 1 ? ___NextExpandedNode(__this.SelectedNode) : ___PreviousExpandedNode(__this.SelectedNode));
        
        if (o != null)
        {
            ___UnselectNode(__this.SelectedNode);
            
            __this.SelectedNode = o;
            ___SelectNode(__this.SelectedNode, "Selected");
            __this.SelectedNode.EnsureVisible(false, false, true);
            
            if (useTimerRepeat)
            {
                __timer = setTimeout(__controlName + "._MoveToNodeByDirection(" + direction + ", true)", __keyboardSpeed);
            }
        }
        else
        {
            __timer = null;
        }
        
        __hasScrolled = true;
    }
    
    this._OnBeforeSelect = function(/*String*/ controlName, /*Boolean*/ useHover)
    {
        var o = ___FindNode(___CreateNodeIndex(controlName));
        
        if (o != null)
        {
            if (___TryEventMouseClick(__this))
            {
                if (o != this.SelectedNode || __selectNodeNonFocus)
                {
                    ___UnselectNode(this.SelectedNode);
                    
                    if (typeof this.OnBeforeSelect == "function")
                    {
                        this.OnBeforeSelect(o);
                    }
                    
                    ___SelectNode(o, "Selected", useHover, true);
                }
                
                __beforeSelectTreeNode = o;
            }
        }
    }
    
    this._OnNodeMouseClick = function(/*String*/ controlName)
    {
        var o = ___FindNode(___CreateNodeIndex(controlName));
        
        if (o != null)
        {
            if (typeof this.OnNodeMouseClick == "function")
            {
                this.OnNodeMouseClick(o);
            }
        }
    }
    
    this._OnNodeMouseDoubleClick = function(/*String*/ controlName)
    {
        var o = ___FindNode(___CreateNodeIndex(controlName));
        
        if (o != null)
        {
            if (typeof this.OnNodeMouseDoubleClick == "function")
            {
                this.OnNodeMouseDoubleClick(o);
            }
        }
    }
    
    this._OnNodeMouseEnter = function(/*String*/ controlName, /*Node*/ element)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
            {
                ___Select(node, true, (node.IsSelected ? "Selected" : "Unselected"), true);
            }
            
            if (this.ShowNodeToolTips && node.ToolTipText != null && element != null)
            {
                if (this.Scrollable && !this.SystemScrollBar && !this.ScrollBar._IsElementVisible(element, (node.Level * this.Indent) + (this.RightToLeft ? this.Right : this.Left)))
                {
                    element.title = node.ToolTipText;
                }
            }
            
            if (typeof this.OnNodeMouseHover == "function")
            {
                this.OnNodeMouseHover(node);
            }
        }
    }
    
    this._OnNodeMouseHover = function(/*String*/ controlName, /*Node*/ element)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            if (typeof this.OnNodeMouseHover == "function")
            {
                this.OnNodeMouseHover(node);
            }
        }
    }
    
    this._OnNodeMouseLeave = function(/*String*/ controlName, /*Node*/ element)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
            {
                ___Select(node, node.IsSelected, (this.ContainsFocus ? "Selected" : "NonFocus"), false);
            }
            
            if (element != null)
            {
                element.title = "";
            }
            
            if (typeof this.OnNodeMouseLeave == "function")
            {
                this.OnNodeMouseLeave(node);
            }
        }
    }
    
    this._ProcessFadePlusMinus = function(/*Integer*/ direction)
    {
        var b = false;
        
        if (direction == 1)
        {
            __fadeCurrent = Math.min(__fadeCurrent + __fadeIncrement, __fadeMaxOpacity);
            b = (__fadeCurrent == __fadeMaxOpacity);
        }
        else if (direction == -1)
        {
            __fadeCurrent = Math.max(__fadeCurrent - __fadeIncrement, __fadeMinOpacity);
            b = (__fadeCurrent == __fadeMinOpacity);
        }
        
        for (var i = 0; i < __nodesVisible.length; i++)
        {
            var node = document.getElementById(__nodesVisible[i] + "$PlusMinus");
            
            if (node != null)
            {
                document.getElementById(__nodesVisible[i] + "$PlusMinus").style.filter = "alpha(opacity=" + __fadeCurrent + ")";
            }
        }
        
        if (!b)
        {
            __fadeTimer = setTimeout(__controlName + "._ProcessFadePlusMinus(" + direction + ")", (direction == 1 ? __fadeInSpeed : __fadeOutSpeed));
        }
    }
    
    this._SetImage = function(/*TreeNode*/ node)
    {
        if (!this.CheckBoxes)
        {
            var n = ___GetImageIndex(node);
            
            if (n != -1)
            {
                __System.Controls.DOM.SetImageSrc(node.ControlName.get() + "$Image", this.ImageList.Images[n]);
            }
        }
    }
    
    this._SetPlusMinus = function(/*String*/ controlName, /*Boolean*/ select)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            __System.Controls.DOM.SetImageSrc(controlName + "$PlusMinus", __resources[(node.IsExpanded ? "Plus" : "Minus")].Build((select ? 1 : 0), this.RightToLeft));
        }
    }
    
    this._Toggle = function(/*String*/ controlName, /*Boolean*/ useHover)
    {
        var node = ___FindNode(___CreateNodeIndex(controlName));
        
        if (node != null)
        {
            if (___TryEventMouseClick(__this))
            {
                if (__beforeSelectTreeNode == null || __beforeSelectTreeNode == node)
                {
                    this.BeginUpdate();
                    
                    if (!node.IsExpanded)
                    {
                        if (typeof this.OnBeforeExpand == "function")
                        {
                            this.OnBeforeExpand(node);
                        }
                    }
                    else
                    {
                        if (typeof this.OnBeforeCollapse == "function")
                        {
                            this.OnBeforeCollapse(node);
                        }
                    }
                    
                    if (!this.ShowPlusMinus)
                    {
                        if (this.SelectedNode != null && this.SelectedNode != node)
                        {
                            this.SelectedNode.IsSelected = false;
                            this._SetImage(this.SelectedNode);
                            ___UnselectNode(this.SelectedNode);
                        }
                    }
                    
                    if (!node.IsExpanded)
                    {
                        node.EnsureVisible(true);
                        node.Expand();
                    }
                    else
                    {
                        node.Collapse();
                    }
                    
                    if (!this.ShowPlusMinus)
                    {
                        this.SelectedNode = node;
                        this.SelectedNode.IsSelected = true;
                        this._SetImage(this.SelectedNode);
                    }
                    
                    if (node.IsExpanded)
                    {
                        if (typeof this.OnAfterExpand == "function")
                        {
                            this.OnAfterExpand(node);
                        }
                    }
                    else
                    {
                        if (this.ShowPlusMinus)
                        {
                            if (this.SelectedNode != null && this.SelectedNode.Level > node.Level)
                            {
                                var o = this.SelectedNode;
                                
                                while (o.Level > node.Level)
                                {
                                    o = o.Parent;
                                }
                                
                                if (node == o)
                                {
                                    this.SelectedNode.IsSelected = false;
                                    this._SetImage(this.SelectedNode);
                                    ___UnselectNode(this.SelectedNode);
                                    
                                    if (typeof this.OnBeforeSelect == "function")
                                    {
                                        this.OnBeforeSelect(node);
                                    }
                                    
                                    this.SelectedNode = node;
                                    this.SelectedNode.IsSelected = true;
                                    this._SetImage(this.SelectedNode);
                                    
                                    if (typeof this.OnAfterSelect == "function")
                                    {
                                        this.OnAfterSelect(node);
                                    }
                                }
                            }
                        }
                        
                        if (typeof this.OnAfterCollapse == "function")
                        {
                            this.OnAfterCollapse(node);
                        }
                    }
                    
                    if (!this.ShowPlusMinus)
                    {
                        if (typeof this.OnAfterSelect == "function")
                        {
                            this.OnAfterSelect(node);
                        }
                    }
                    
                    this.EndUpdate();
                    this.Refresh();
                    
                    if (useHover)
                    {
                        ___SelectNode(__this.SelectedNode, "Selected", useHover, true);
                    }
                }
                else if (__beforeSelectTreeNode != this.SelectedNode)
                {
                    ___UnselectNode(__beforeSelectTreeNode);
                }
                
                __beforeSelectTreeNode = null;               
            }
        }
    }
    
    this.BeginUpdate = function()
    {
        __updating = true;
    }
    
    this.CollapseAll = function()
    {
        this.BeginUpdate();
        
        var o = this.Nodes.GetEnumerator();
        
        while (o.MoveNext())
        {
            this.Nodes[o.Current].Collapse(false);
        }
        
        ___UnselectNode(this.SelectedNode);
        this.SelectedNode = null;
        
        this.EndUpdate();
        this.Refresh();
    }
    
    this.EndUpdate = function()
    {
        __updating = false;
    }
    
    this.ExpandAll = function()
    {
        this.BeginUpdate();
        
        var o = this.Nodes.GetEnumerator();
        
        while (o.MoveNext())
        {
            this.Nodes[o.Current].ExpandAll();
        }
        
        this.EndUpdate();
        this.Refresh();
    }
    
    this.Focus = function()
    {
        if (!__this.ContainsFocus && __System.Controls.DOM.IsVisible(__pageNode) && ___TryEventFocus())
        {
            __pageNode.focus();
            
            ___SelectNode(this.SelectedNode, "Selected");
            __selectNodeNonFocus = false;
        }
    }
    
    this.GetNodeAt = function(/*Point|Integer*/ point0, /*Integer*/ point1)
    {
        if (point1 != null)
        {
            point0 = { X: point0, Y: point1 };
        }
        
        return ___FindNodeByCoordinates(this.Nodes, point0);
    }
    
    this.GetNodeCount = function(/*Boolean*/ includeSubTrees)
    {
        var n = this.Nodes.Count;
        
        if (includeSubTrees)
        {
            var o = this.Nodes.GetEnumerator();
            
            while (o.MoveNext())
            {
                n += this.Nodes[o.Current].GetNodeCount(true);
            }
        }
        
        return n;
    }
    
    this.Refresh = function()
    {
        if (!__updating)
        {
            if (this.Scrollable && !this.SystemScrollBar)
            {
                if (this.FullRowSelect && this.SelectedNode != null)
                {
                    this.SelectedNode.TextDOM.style.width = "";
                }
                
                this.ScrollBar._Refresh();
                
                if (this.FullRowSelect && this.SelectedNode != null)
                {
                    ___SetNodeWidth(__this.SelectedNode);
                }
            }
        }
    }
    
    this.Sort = function()
    {
        this.Nodes = ___SortNodes(this.Nodes, new function(obj0, obj1)
                                              {
                                                  if (obj0.Text != null && obj1.Text != null)
                                                  {
                                                      if (obj0.Text == obj1.Text)
                                                      {
                                                          return 0;
                                                      }
                                                      else if (obj0.Text < obj1.Text)
                                                      {
                                                          return 1;
                                                      }
                                                  }
                                                  
                                                  return -1;
                                            }, true);
        
        var b = this.Sorted;
        this.Sorted = false;
        
        this._Draw(this);
        
        this.Sorted = b;
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
            
            if (this.Scrollable && !this.SystemScrollBar)
            {
                this.ScrollBar.Show(__visible);
            }
            
            __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            
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
                        __origOverflow = style.overflow;
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
                    style.backgroundImage = __System.Convert._IsNullToDefault(this.BackgroundImage, "");
                    style.backgroundPosition = __System.Convert._IsNullToDefault(this.BackgroundImageLayout, "");
                    style.backgroundRepeat = __System.Convert._IsNullToDefault(this.BackgroundImageRepeat, "");
                    style.border = ((this.Scrollable && !this.SystemScrollBar) || this.BorderStyle == null ? "" : this.BorderStyle + (this.BorderSize != null ? " " + this.BorderSize + "px" : "") + (this.BorderColor != null ? " " + this.BorderColor : ""));
                    style.overflow = (this.Scrollable && this.SystemScrollBar ? "" : __origOverflow);
                    style.zIndex = __System.Convert._IsNullToDefault(this.ZIndex, "");
                    style.cursor = __System.Convert._IsNullToDefault(this.Cursor, "");
                    
                    dir = (this.RightToLeft ? "rtl" : "");
                    tabindex = __System.Convert._IsNullToDefault(this.TabIndex, "");
                    unselectable = "on";
                    
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
                        
                        if (!__this.ContainsFocus && __System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
                        {
                            if (__fadeCurrent < __fadeMaxOpacity)
                            {
                                ___FadePlusMinus(1);
                            }
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
                        
                        if (__this.Scrollable && !__this.SystemScrollBar && !__this.ContainsFocus && __System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
                        {
                            if (__fadeCurrent > __fadeMinOpacity)
                            {
                                ___FadePlusMinus(-1);
                            }
                        }
                    }
                    
                    onmousedown = function()
                    {
                        if (__System.Threading.Monitor._IsAvailable(__System.Controls.EventType.MouseDown))
                        {
                            if (!__this.SystemScrollBar && __this.Nodes.Count > 0)
                            {
                                var n = __System.Controls.DOM.ConvertPoint(event).Y - (__this.BorderStyle != null ? __this.BorderSize : 0) - __System.Controls.DOM.Location(__pageNode, true).Y - __this.Top + (__this.ScrollBar.VScrollBar.Visible ? Math.abs(__this.ScrollBar._ScrollTop()) : document.body.scrollTop);
                                
                                if (n >= 0)
                                {
                                    var node = ___FindNodeByCoordinates(__this.Nodes, { X: null, Y: n });
                                    
                                    if (node != null)
                                    {
                                        __this._OnBeforeSelect(node.ControlName.get());
                                        __this._Expand(node.ControlName.get());
                                    }
                                }
                            }
                        }
                        
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
                
                if (this.Nodes.Count > 0)
                {
                    if (this.Scrollable && !this.SystemScrollBar)
                    {
                        this.ScrollBar.PageID = this.PageID;
                        this.ScrollBar.Location = this.Location;
                        this.ScrollBar.RightToLeft = this.RightToLeft;
                        this.ScrollBar.VScrollBar.Dock = (!this.RightToLeft && this.RightToLeftLayout ? __System.Controls.UI.Components.DockStyle.Left : null);
                        this.ScrollBar.Width = this.Width;
                        this.ScrollBar.Height = this.Height;
                        this.ScrollBar.BorderColor = this.BorderColor;
                        this.ScrollBar.BorderSize = this.BorderSize;
                        this.ScrollBar.BorderStyle = this.BorderStyle;
                        this.ScrollBar.Cursor = this.Cursor;
                        this.ScrollBar.Created = false;
                        this.ScrollBar.Load();
                    }
                    else
                    {
                        this.ScrollBar.Show(false);
                    }
                    
                    this._Draw(this);
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
                                if (__this.Scrollable && !__this.SystemScrollBar && __fadeCurrent < __fadeMaxOpacity)
                                {
                                    ___FadePlusMinus(1);
                                }
                                
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
                                if (__this.SelectedNode != null)
                                {
                                    if (__this.HideSelection)
                                    {
                                        ___UnselectNode(__this.SelectedNode);
                                    }
                                    else 
                                    {
                                        ___Select(__this.SelectedNode, true, "NonFocus", false);
                                        __selectNodeNonFocus = true;
                                    }
                                }
                                
                                ___RemoveEventFocus();
                                
                                if (__this.Scrollable && !__this.SystemScrollBar && __fadeCurrent > __fadeMinOpacity)
                                {
                                    ___FadePlusMinus(-1);
                                }
                                
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
                    if (__beforeSelectTreeNode != __this.SelectedNode)
                    {
                        ___UnselectNode(__beforeSelectTreeNode);
                        ___SelectNode(__this.SelectedNode, "Selected");
                    }
                    
                    __beforeSelectTreeNode = null;
                    
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
                    
                    if (__this.ScrollBar.Created)
                    {
                        __this.ScrollBar._EVENTS.MouseWheel(evt, true);
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
                    
                    if (!evt.ctrlKey && __this.Nodes.Count > 0)
                    {
                        if (__timer == null)
                        {
                            switch (evt.keyCode)
                            {
                                case 38:
                                    __timer = setTimeout(__controlName + "._MoveToNodeByDirection(-1, true)", __keyboardSpeed);
                                    break;
                                case 40:
                                    __timer = setTimeout(__controlName + "._MoveToNodeByDirection(1, true)", __keyboardSpeed);
                                    break;
                            }
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
                    
                    if (__this.Nodes.Count > 0)
                    {
                        clearTimeout(__timer);
                        __timer = null;
                        
                        if (!__hasScrolled)
                        {
                            switch (evt.keyCode)
                            {
                                case 38:
                                    __this._MoveToNodeByDirection(-1);
                                    break;
                                case 40:
                                    __this._MoveToNodeByDirection(1);
                                    break;
                            }
                        }
                        
                        __hasScrolled = false;
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

if (typeof TreeView == "undefined")
{
    TreeView = __System.Controls.UI.TreeView;
}

__System.Import("System.Controls.UI.TreeView", true);
