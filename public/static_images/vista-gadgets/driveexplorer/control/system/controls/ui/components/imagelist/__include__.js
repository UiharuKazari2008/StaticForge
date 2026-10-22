////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.ImageList = function()
{
    var __width = 16;
    var __height = 16;
    var __this = this;
    
    this.Images = new __System.Controls.UI.Components.ImageList.ImageCollection();
    
    this.ImageSize =
    {
        get: function()
        {
            return { Width: __width, Height: __height };
        },
        set: function(/*Integer*/ width, /*Integer*/ height)
        {
            if (width != null && height != null)
            {
                __width = parseInt(width);
                __height = parseInt(height);
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
        
        return obj0.Images.Equals(obj1.Images);
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
        
        if (this.Images != null)
        {
            return this.Images.ToString();
        }
    }
}

if (typeof ImageList == "undefined")
{
    ImageList = __System.Controls.UI.Components.ImageList;
}

__System.Import("System.Controls.UI.Components.ImageList", true);
__System.Import("System.Controls.UI.Components.ImageList.ImageCollection");
