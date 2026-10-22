////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.Span = function()
{
    this.BackColor = null;
    this.BackgroundImage = null;
    this.BackgroundImageRepeat = null;
    this.BackgroundImageLayout = null;
    this.Cursor = null;
    this.Font = null;
    this.ForeColor = null;
    this.Height = null;
    this.Location = { X: null, Y: null };
    this.Padding = 0;
    this.RightToLeft = false;
    this.Src = null;
    this.Text = null;
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
            
            if (x != null)
            {
                __this.Location.X = __System.Convert.ToInt32(x);
            }
            
            if (y != null)
            {
                __this.Location.Y = __System.Convert.ToInt32(y);
            }
            
            __this.Size.set(width, height);
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
        }
    }    
}

if (typeof Span == "undefined")
{
    Span = __System.Controls.UI.Components.Span;
}

__System.Import("System.Controls.UI.Components.Span", true);
