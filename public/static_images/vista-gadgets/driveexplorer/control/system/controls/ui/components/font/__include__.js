////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.Font = function(/*String*/ font, /*String*/ size, /*FontStyle*/ style, /*String*/ color)
{
    this.Italic = ((style & __System.Controls.UI.Components.FontStyle.Italic) == __System.Controls.UI.Components.FontStyle.Italic);
    this.Bold = ((style & __System.Controls.UI.Components.FontStyle.Bold) == __System.Controls.UI.Components.FontStyle.Bold);
    this.FontFamily = __System.Convert._IsNullToDefault(__System.Convert.ToString(font), null);
    this.ForeColor = __System.Convert._IsNullToDefault(__System.Convert.ToString(color), null);
    this.Height = null;
    this.Size = __System.Convert._IsNullToDefault(size, null);
    this.Strikeout = ((style & __System.Controls.UI.Components.FontStyle.Strikeout) == __System.Controls.UI.Components.FontStyle.Strikeout);
    this.Style = __System.Convert._IsNullToDefault(__System.Convert.ToInt32(style), null);
    this.Underline = ((style & __System.Controls.UI.Components.FontStyle.Underline) == __System.Controls.UI.Components.FontStyle.Underline);
    
    this.Clone = function()
    {
        // summary:
        //   Creates an exact copy of this Font.
        //
        // arguments:
        //   none
        //
        // returns: Font
        
        return new __System.Controls.UI.Components.Font(this.FontFamily, this.Size, this.Style, this.ForeColor);
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
        
        __System.Object.Equals(obj0, (obj1 != null ? obj1 : this));
    }
    
    this.GetHeight = function()
    {
        // summary:
        //   Returns the line spacing of this font.
        //
        // arguments:
        //   none
        //
        // returns: Integer
        
        return this.Height;
    }
    
    this.ReferenceEquals = function(/*Object*/ obj0, /*Object*/ obj1)
    {
        // summary:
        //   Determines whether the specified Object instances
        //   are the same instance.
        //
        // arguments:
        //   obj0 (required)
        //   obj1 (required)
        //
        // returns: Boolean
        
        return __System.Object.ReferenceEquals(obj0, (obj1 != null ? obj1 : this));
    }
    
    this.ToString = function()
    {
        // summary:
        //   Returns a string that represents the current ImageList.
        //
        // arguments:
        //   none
        //
        // returns: String
        
        return this.FontFamily + (this.Size != null ? ", " + this.Size : "") + (this.ForeColor ? ", " + this.ForeColor : "") + (this.Bold ? ", bold" : "") + (this.Italic ? ", italic" : "") + (this.Strikeout ? ", strikeout" : "") + (this.Underline ? ", underline" : "");
    }
}

if (typeof Font == "undefined")
{
    Font = __System.Controls.UI.Components.Font;
}

__System.Import("System.Controls.UI.Components.Font", true);
