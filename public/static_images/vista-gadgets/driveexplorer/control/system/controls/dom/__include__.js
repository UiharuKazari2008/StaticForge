////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.DOM =
{
    _bidiOffsetX: 16,
    _bidiOffsetY: 0,
    Append: function(/*Object*/ properties)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  properties (required)
        //
        // returns: Node
        
        var node;
        var b = true;
        
        if (document.getElementById(properties.ID) != null)
        {
            node = document.getElementById(properties.ID);
            b = false;
        }
        else
        {
            node = document.createElement((properties.Type != null ? properties.Type : "DIV"));
            node.id = properties.ID;
        }
        
        if (properties.Parent != null)
        {
            parentNode = this.ConvertToNode(properties.Parent);
            parentNode.appendChild(node);
        }
        else if (b)
        {
            document.body.appendChild(node);
        }
        
        with (node)
        {
            style.position = (properties.Position != null ? properties.Position : "absolute");
            
            if (properties.X != null)
            {
                style.left = properties.X;
            }
            
            if (properties.Y != null)
            { 
                style.top = properties.Y;
            }
            
            if (properties.Width != null)
            {
                style.width = properties.Width;
            }
            
            if (properties.Height != null)
            {
                style.height = properties.Height;
            }
            
            if (properties.FontSize != null)
            {
                style.fontSize = properties.FontSize;
            }
            
            if (properties.Padding != null)
            {
                style.padding = properties.Padding;
            }
            
            if (properties.BackColor != null)
            {
                style.backgroundColor = properties.BackColor;
            }
            
            if (properties.Background != null)
            {
                style.background = properties.Background;
            }
            
            if (properties.Border != null)
            {
                style.border = properties.Border;
            }
            
            if (properties.ZIndex != null)
            {
                style.zIndex = properties.ZIndex;
            }
            
            if (properties.Cursor != null)
            {
                style.cursor = properties.Cursor;
            }
            
            if (properties.Visibility != null)
            {
                style.visibility = (properties.Visibility ? "visible" : "hidden");
            }
            
            if (properties.Opacity != null)
            {
                style.filter = "alpha(opacity=" + properties.Opacity + ")";
            }
            
            if (properties.Overflow != null)
            {
                style.overflow = properties.Overflow;
            }
            
            if (properties.Src != null)
            {
                src = properties.Src;
            }
            
            if (properties.Html != null)
            {
                innerHTML = properties.Html;
            }
            
            if (properties.RightToLeft != null)
            {
                dir = (properties.RightToLeft ? "rtl" : "ltr");
            }
            
            unselectable = "on";
        }
        
        return node;
    },
    Bounds: function(/*String|Node*/ element, /*String|Node*/ parentElement)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  parentElement (optional)
        //
        // returns: Object
        
        var p = { X: null, Y: null, Width: null, Height: null};
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            p.Width = node.offsetWidth;
            p.Height = node.offsetHeight;
            
            if (parentElement)
            {
                var o = node;
                var o1 = this.ConvertToNode(parentElement);
                
                while (o && o != o1)
                {
                    p.X += o.offsetLeft;
                    p.Y += o.offsetTop;
                    o = o.offsetParent;
                }
            }
            else
            {
                p.X = parseInt(node.style.left);
                p.Y = parseInt(node.style.top);
            }
        }
        
        return p;
    },
    Location: function(/*String|Node*/ element, /*String|Node*/ parentElement)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  parentElement (optional)
        //
        // returns: Object
        
        var p = { X: null, Y: null};
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            if (parentElement)
            {
                var o = node;
                var o1 = this.ConvertToNode(parentElement);
                
                while (o && o != o1)
                {
                    p.X += o.offsetLeft;
                    p.Y += o.offsetTop;
                    o = o.offsetParent;
                }
            }
            else
            {
                p.X = parseInt(node.style.left);
                p.Y = parseInt(node.style.top);
            }
        }
        
        return p;
    },
    Remove: function(/*String|Node*/ element, /*Node*/ parentNode)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  parentNode (optional)
        //
        // returns: Nothing
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            var b = true;
            
            if (node.innerHTML)
            {
                node.innerHTML = "";
            }
            
            parentNode = this.ConvertToNode(parentNode);
            
            if (parentNode != null)
            {
                try
                {
                    parentNode.removeChild(node);
                    b = false;
                }
                catch (e)
                {
                    b = true;
                }
            }
            
            if (b)
            {
                try
                {
                    document.body.removeChild(node);
                }
                catch (e)
                {
                    node.style.visibility = "hidden";
                }
            }
        }
    },
    Size: function(/*String|Node*/ element, /*Boolean*/ useOffset)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  useOffset (optional)
        //
        // returns: Object
        
        var p = { Width: null, Height: null};
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            if (useOffset)
            {
                p.Width = node.offsetWidth;
                p.Height = node.offsetHeight;
            }
            else
            {
                p.Width = parseInt(node.style.width);
                p.Height = parseInt(node.style.height);
            }
        }
        
        return p;
    },
    FindUnused: function(/*String*/ controlName)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  controlName (required)
        //
        // returns: String
        
        var s;
        var i = 0;
        
        do
        {
            s = controlName + "$" + i;
            
            var b = true;
            
            try
            {
                eval(s);
            }
            catch(e)
            {
                b = false
            }
            
            i++;
        }
        while (b)
        
        return s;
    },
    ConvertToNode: function(/*String|Node*/ element)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //
        // returns: Node
        
        var node = null;
        
        if (typeof element == "string")
        {
            node = document.getElementById(element);
        }
        else if (typeof element == "object")
        {
            node = element;
        }
        
        return node;
    },
    IsElementWithin: function(/*String|Node*/ element, /*Object*/ point)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  point (required)
        //
        // returns: Boolean
        
        return this.IsPointWithin(this.Bounds(element, true), point);
    },
    IsParentElement: function(/*String|Node*/ element, /*String|Node*/ parentElement)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  parentElement (required)
        //
        // returns: Boolean
        
        element = this.ConvertToNode(element);
        parentElement = this.ConvertToNode(parentElement);
        
        if (element != null && parentElement != null)
        {
            var n = 0;
            
            while (element != null)
            {
                if (element == parentElement)
                {
                    return n;
                }
                
                element = element.offsetParent;
                
                n++;
            }
        }
        
        return -1;
    },
    IsPointWithin: function(/*Object*/ dimension, /*Point*/ point, /*Integer*/ direction, /*Boolean*/ isVertical)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  dimension (required)
        //  point (required)
        //  direction (optional)
        //  isVertical (optional)
        //
        // returns: Boolean
        
        point = this.ConvertPointToRTL(point);
        
        if (direction == 1)
        {
            return (isVertical ? dimension.Y + dimension.Height < point.Y : dimension.X + dimension.Width < point.X);
        }
        else if (direction == -1)
        {
            return (isVertical ? point.Y < dimension.Y : point.X < dimension.X);
        }
        
        return (point.X >= dimension.X && point.X <= dimension.X + dimension.Width && point.Y >= dimension.Y && point.Y <= dimension.Y + dimension.Height);
    },
    ConvertPointToRTL: function(/*Point*/ point)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  point (required)
        //
        // returns: Point
        
        if (this.IsPageRTL())
        {
            if (point.X != null)
            {
                point.X -= this._bidiOffsetX;
            }
            
            if (point.Y != null)
            {
                point.Y -= this._bidiOffsetY;
            }
        }
        
        return point;        
    },
    ConvertPoint: function(/*Event*/ evt)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  event (required)
        //
        // returns: Point
        
        return (evt != null ? { X: evt.clientX, Y: evt.clientY } : { X: null, Y: null }); 
    },
    IsPageRTL: function()
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  none
        //
        // returns: Boolean
        
        return (document.getElementsByTagName("HTML")[0].dir.toLowerCase() == "rtl" || document.getElementsByTagName("BODY")[0].dir.toLowerCase() == "rtl");
    },
    ApplyCssText: function(/*String|Node*/ element, /*Object*/ styles, /*String*/ cssName)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  style (required)
        //
        // returns: Nothing
        
        var o = this.ConvertToNode(element);
        
        if (o != null)
        {
            with (o)
            {
                if (cssName != null)
                {
                    className = cssName;
                }
                
                if (styles != null)
                {
                    var s = style.cssText
                    
                    for (var prop in styles)
                    {
                        s += ";" + prop + ":" + styles[prop];
                    }
                    
                    style.cssText = s;
                }
            }
        }
    },
    ApplyFontStyle: function(/*String|Node*/ element, /*Font*/ font, /*Boolean*/ useFontColor)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  font (required)
        //  useFontColor (optional)
        //
        // returns: Nothing
        
        if (font != null)
        {
            var o = this.ConvertToNode(element);
            
            if (o != null)
            {
                o.style.fontFamily = __System.Convert._IsNullToDefault(font.FontFamily, "");
                o.style.fontSize = __System.Convert._IsNullToDefault(font.Size, "");
                
                if (useFontColor)
                {
                    o.style.color = __System.Convert._IsNullToDefault(font.ForeColor, o.style.color);
                }
                
                o.style.fontWeight = (font.Bold ? "bold" : "normal");
                o.style.fontStyle = (font.Italic ? "italic" : "normal");
                o.style.textDecorationStrikeout = font.Strikeout;
                o.style.textDecorationUnderline = font.Underline;
            }
        }
    },
    SetImageSrc: function(/*String|Node*/ element, /*String*/ sourceUrl, /*String*/ altText)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  sourceUrl (required)
        //  altText (optional)
        //
        // returns: Nothing
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            node.src = sourceUrl;
            
            if (altText != null)
            {
                node.alt = altText;
            }
        }
    },
    SetOpacity: function(/*String|Node*/ element, /*Integer*/ opacity)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  opacity (required)
        //
        // returns: Nothing
        
        var node = this.ConvertToNode(element);
        
        if (node != null)
        {
            node.style.filter = "alpha(opacity=" + opacity + ")";
        }
    },
    SetDisplay: function(/*String|Node*/ element, /*Boolean*/ isDisplayed)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  isDisplayed (required)
        //
        // returns: Nothing
        
        if (isDisplayed != null)
        {
            var node = this.ConvertToNode(element);
            
            if (node != null)
            {
                node.style.display = (isDisplayed ? "block" : "none");
            }
        }
    },
    IsVisible: function(/*String|Node*/ element)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //
        // returns: Nothing
        
        var node = this.ConvertToNode(element);
        
        return (node != null && node.style.visibility == "visible");
    },
    SetVisibility: function(/*String|Node*/ element, /*Boolean*/ isVisible)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  element (required)
        //  isVisible (required)
        //
        // returns: Nothing
        
        if (isVisible != null)
        {
            var node = this.ConvertToNode(element);
            
            if (node != null)
            {
                node.style.visibility = (isVisible ? "visible" : "hidden");
            }
        }
    },
    CancelEvent: function(/*Event*/ evt)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //  event (required)
        //
        // returns: Nothing
        
        if (evt != null)
        {
            evt.cancelBubble = true;
            evt.returnValue = false;
        }
    }
}

__System.Import("System.Controls.DOM", true);
