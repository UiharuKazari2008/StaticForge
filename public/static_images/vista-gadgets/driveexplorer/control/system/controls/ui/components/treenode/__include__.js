////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.UI.Components.TreeNodeCollection");

__System.Controls.UI.Components.TreeNode = function(/*String*/ text, /*TreeNodeCollection|Boolean|Integer*/ imageIndex, /*TreeNode|Integer*/ imageSelectedIndex, /*TreeNodeCollection|Boolean*/ children)
{
    var argNode = (imageIndex != null && imageSelectedIndex == null && children == null ? imageIndex : children);
    
    var __controlName = null;
    var __this = this;
    
    this.BackColor = null;
    this.Checked = null;
    this.FirstNode = null;
    this.ForeColor = null;
    this.HasNodes = (__System.Type._IsBoolean(__System.Type.GetTypeCode(argNode)) ? argNode : false);
    this.ImageIndex = (__System.Type._IsNumber(__System.Type.GetTypeCode(imageIndex)) ? imageIndex : -1);
    this.ImageKey = null;
    this.Index = -1;
    this.IsExpanded = false;
    this.IsSelected = false;
    this.LastNode = null;
    this.Level = -1;
    this.Name = null;
    this.NodeFont = null;
    this.Nodes = (this.HasNodes || __System.Type._IsEmpty(__System.Type.GetTypeCode(argNode)) || argNode.Nodes == null ? new __System.Controls.UI.Components.TreeNodeCollection() : argNode);
    this.Parent = null;
    this.SelectedImageIndex = (__System.Type._IsNumber(__System.Type.GetTypeCode(imageSelectedIndex)) ? imageSelectedIndex : -1);
    this.SelectedImageKey = null;
    this.Tag = null;
    this.Text = __System.Convert._IsNullToDefault(__System.Convert.ToString(text), "");
    this.TextDOM = null;
    this.ToolTipText = null;
    this.TreeView = null;
    
    this.ControlName =
    {
        get: function()
        {
            return __controlName;
        },
        set: function(/*String*/ name)
        {
            __controlName = name;
        }        
    }
    
    this.Bounds =
    {
        get: function()
        {
            var bounds = { X: null, Y: null, Width: null, Height: null };
            
            if (__this.TreeView != null)
            {
                if (__this.TreeView._IsNodeVisible(__this))
                {
                    var o = __this.TreeView._GetNodeLocation(__this);
                    bounds.X = o.X;
                    bounds.Y = o.Y;
                }
                
                var o = __System.Controls.DOM.Size(__controlName + "$TreeNode", true);
                bounds.Width = o.Width;
                bounds.Height = o.Height;
            }
            
            return bounds;
        }
    }
    
    this.FirstNode =
    {
        get: function()
        {
            return (__this.Nodes.Count > 0 != null ? __this.Nodes[0] : null);
        }
    }
    
    this.FullPath =
    {
        get: function()
        {
            return (__this.Parent != null ? __this.Parent.FullPath.get() + __this.TreeView.PathSeparator : "") + __this.Text;
        }
    }
    
    this.IsVisible =
    {
        get: function()
        {
            if (__this.TreeView != null)
            {
                if (__this.Parent == null || __this.TreeView._IsNodeVisible(__this))
                {
                    if (__this.TreeView.Scrollable && !__this.TreeView.SystemScrollBar)
                    {
                        return __this.TreeView.ScrollBar._IsElementVisible(__controlName + "$Root", (__this.Level * __this.TreeView.Indent) + (__this.TreeView.RightToLeft ? __this.TreeView.Right : __this.TreeView.Left), true);
                    }
                    
                    return true;
                }
            }
            
            return false;
        }
    }
    
    this.LastNode =
    {
        get: function()
        {
            return (__this.Nodes.Count > 0 != null ? __this.Nodes[__this.Nodes.Count - 1] : null);
        }
    }
    
    this.NextNode =
    {
        get: function()
        {
            var o = (__this.Parent != null ? __this.Parent : (__this.Level == 0 ? __this.TreeView : null));
            
            if (o != null && __this.Index != -1 && __this.Index < o.GetNodeCount() - 1)
            {
                return o.Nodes[__this.Index + 1];
            }
            
            return null;
        }
    }
    
    this.NextVisibleNode =
    {
        get: function()
        {
            var o = (__this.Parent != null ? __this.Parent : (__this.Level == 0 ? __this.TreeView : null));
            
            if (o != null)
            {
                for (var i = __this.Index + 1; i < o.GetNodeCount(); i++)
                {
                    if (o.Nodes[i].IsVisible.get())
                    {
                        return o.Nodes[i];
                    }
                }
            }
            
            return null;
        }
    }
    
    this.PrevNode =
    {
        get: function()
        {
            var o = (__this.Parent != null ? __this.Parent : (__this.Level == 0 ? __this.TreeView : null));
            
            if (o != null && __this.Index > 0)
            {
                return o.Nodes[__this.Index - 1];
            }
            
            return null;
        }
    }
    
    this.PrevVisibleNode =
    {
        get: function()
        {
            var o = (__this.Parent != null ? __this.Parent : (__this.Level == 0 ? __this.TreeView : null));
            
            if (o != null && __this.Index > 0)
            {
                for (var i = __this.Index - 1; i >= o.GetNodeCount(); i--)
                {
                    if (o.Nodes[i].IsVisible.get())
                    {
                        return o.Nodes[i];
                    }
                }
            }
            
            return null;
        }
    }
    
    this.Collapse = function(/*Boolean*/ ignore, /*Boolean*/ _bypassRefresh)
    {
        if (this.IsExpanded || ignore != null)
        {
            ignore = (ignore != null ? ignore : true);
            
            if (!ignore)
            {
                var o = this.Nodes.GetEnumerator();
                
                while (o.MoveNext())
                {
                    this.Nodes[o.Current].Collapse(false, true);
                }
            }
            
            __System.Controls.DOM.SetDisplay(__controlName + "$Nodes", false);
            this.IsExpanded = false;
            
            if (this.TreeView.ShowPlusMinus)
            {
                this.TreeView._SetPlusMinus(__controlName);
            }
            
            this.TreeView._SetImage(this);
            
            if (!_bypassRefresh && this.TreeView != null)
            {
                this.TreeView.Refresh();
            }
        }
    }
    
    this.EnsureVisible = function(/*Boolean*/ _bypassVisible, /*Boolean*/ _bypassVScroll, /*Boolean*/ _bypassHScroll)
    {
        if (__controlName != null)
        {
            var o = this;
            
            while (o != null)
            {
                o = o.Parent;
                
                if (o != null)
                {
                    if (this.TreeView == null && o.TreeView != null)
                    {
                        this.TreeView = o.TreeView;
                    }
                    
                    o.Expand();
                }
            }
            
            if (!_bypassVisible && this.TreeView != null && this.TreeView.Scrollable && !this.TreeView.SystemScrollBar)
            {
                this.TreeView.ScrollBar._EnsureVisible(__controlName + "$Root", (__this.Level * __this.TreeView.Indent) + (__this.TreeView.RightToLeft ? __this.TreeView.Right : __this.TreeView.Left), _bypassVScroll, _bypassHScroll);
            }
        }
    }
    
    this.Equals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether two Object instances are equal.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (optional)
        //
        // returns: Boolean
        
        obj1 = (obj1 != null ? obj1 : this);
        
        return __System.Object.Equals(obj0, obj1);
    }
    
    this.Expand = function(/*Boolean*/ _bypassRefresh)
    {
        var nodes = document.getElementById(__controlName + "$Nodes");
        
        if (nodes != null && this.TreeView != null && (this.GetNodeCount() > 0 || this.HasNodes) && (!this.IsExpanded || nodes.innerHTML == ""))
        {
            if (nodes.innerHTML == "")
            {
                this.TreeView._Draw(this);
            }
            
            __System.Controls.DOM.SetDisplay(__controlName + "$Nodes", true);
            this.IsExpanded = true;
            
            if (this.TreeView.ShowPlusMinus)
            {
                this.TreeView._SetPlusMinus(__controlName);
            }
            
            this.TreeView._SetImage(this);
            
            if (!_bypassRefresh && this.TreeView != null)
            {
                this.TreeView.Refresh();
            }
        }
    }
    
    this.ExpandAll = function(/*Boolean*/ _bypassRefresh)
    {
        this.Expand(true);
        
        var o = this.Nodes.GetEnumerator();
        
        while (o.MoveNext())
        {
            this.Nodes[o.Current].ExpandAll(true);
        }
        
        this.IsExpanded = true;
        
        if (!_bypassRefresh && this.TreeView != null)
        {
            this.TreeView.Refresh();
        }
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
    
    this.ReferenceEquals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether two Object instances are equal.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (optional)
        //
        // returns: Boolean
        
        obj1 = (obj1 != null ? obj1 : this);
        
        return __System.Object.ReferenceEquals(obj0, obj1);
    }
    
    this.Remove = function()
    {
        var o = (this.Parent != null ? this.Parent : this.TreeView);
        
        if (o != null)
        {
            o.Nodes.RemoveAt(this.Index);
            
            if (this.TreeView != null)
            {
                this.TreeView._Draw(o);
            }
        }
    }
    
    this.Toggle = function()
    {
        if (this.IsExpanded)
        {
            this.Collapse();
        }
        else
        {
            this.Expand();
        }
    }
    
    this.ToString = function()
    {
        // summary:
        //   Returns a String that represents the current Object.
        //
        // arguments:
        //   none
        //
        // returns: String
        
        return this.Text + "," + this.Nodes.ToString();
    }
}

if (typeof TreeNode == "undefined")
{
    TreeNode = __System.Controls.UI.Components.TreeNode;
}

__System.Import("System.Controls.UI.Components.TreeNode", true);
