////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Controls.DOM");

__System.Controls.UI.Spinner = function(/*String*/ location)
{
    var __pageName = "Spinner";
    var __controlName = __System.Controls.DOM.FindUnused(__pageName);
    var __pageNode = null;
    var __imageNode = null;
    var __resource = { Path: null, Xml: null, Parsing: false, Children: [] };
    var __resources = [];
    var __timer = null;
    var __visible = false;
    var __this = this;
    eval(__controlName + " = this;");
    
    this.BackColor = null;
    this.BorderColor = null;
    this.BorderSize = 1;
    this.BorderStyle = null;
    this.Bottom = 0;
    this.Clockwise = true;
    this.Cursor = null;
    this.Created = false;
    this.Height = 16;
    this.ImageLocation = __System.Convert._IsNullToDefault(location, __System.BasePath + "resources/ui/" + __pageName + "/spinner.png");
    this.Increment = 16;
    this.Left = 0;
    this.Length = 288;
    this.Location = { X: null, Y: null };
    this.OnAfterLoad = null;
    this.OnBeforeLoad = null;
    this.PageID = null;
    this.ResourcePath = null;
    this.Right = 0;
    this.Speed = 20;
    this.Top = 0;
    this.Visible = false;
    this.Width = 16;
    this.ZIndex = null;
    
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
    
    this._Process = function()
    {
        // summary:
        //   Rotates the control image strip continuously.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (__imageNode != null) 
        {
            var x = parseInt(__imageNode.style.left) + (this.Increment * (this.Clockwise ? -1 : 1));
            
            if (this.Clockwise)
            {
                if (Math.abs(x) >= this.Length)
                {
                    x = 0;
                }
            }
            else
            {
                if (x >= 0)
                {
                    x = this.Increment - this.Length;
                }
            }
            
            __imageNode.style.left = x;
            
            __timer = setTimeout(__controlName + "._Process()", this.Speed);
        }
    }
    
    this.Start = function()
    {
        // summary:
        //   Initiates the interval timer to rotate the image.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (this.Created)
        {
            __timer = setTimeout(__controlName + "._Process()", this.Speed);
        }
    }
    
    this.Pause = function()
    {
        // summary:
        //   Stops the control rotation by clearing the timer.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        clearTimeout(__timer);
        __timer = null;
    }
    
    this.Remove = function()
    {
        // summary:
        //   User procedure to remove the control.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        if (this.Created)
        {
            this.Pause();
            __System.Controls.DOM.Remove(__pageNode, this.PageID);
            this.Created = false;
        }
    }
    
    this.Show = function(/*Boolean*/ isVisible)
    {
        // summary:
        //   User procedure to make the control visible.
        //
        // arguments:
        //   isVisible (required)
        //
        // returns: Nothing
        
        if (this.Created)
        {
            __visible = (isVisible != null ? isVisible : true);
            
            if (__pageNode != null)
            {
                if (this.PageID != null)
                {
                    __System.Controls.DOM.SetDisplay(__pageNode, __visible);
                }
                
                __System.Controls.DOM.SetVisibility(__pageNode, __visible);
            }
            else
            {
                __visible = false;
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
                this.Remove();
                
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
                    if (this.Location.X != null || this.Location.Y != null)
                    {
                        style.position = "absolute";
                    }
                    
                    style.left = __System.Convert._IsNullToDefault(this.Location.X, "");
                    style.top = __System.Convert._IsNullToDefault(this.Location.Y, "");
                    style.backgroundColor = __System.Convert._IsNullToDefault(this.BackColor, "");
                    style.padding = this.Top + "px " + this.Right + "px " + this.Bottom + "px " + this.Left + "px";
                    style.border = (this.BorderStyle != null ? this.BorderStyle + (this.BorderSize != null ? " " + this.BorderSize + "px" : "") + (this.BorderColor != null ? " " + this.BorderColor : "") : "");
                    style.zIndex = __System.Convert._IsNullToDefault(this.ZIndex, "");
                    style.cursor = __System.Convert._IsNullToDefault(this.Cursor, "");
                }
                
                __contentNode = __System.Controls.DOM.Append({
                                                               ID: __controlName + "$Content",
                                                               Position: "relative",
                                                               Width: this.Width,
                                                               Height: this.Height,
                                                               Overflow: "hidden",
                                                               Html: '<img id="' + __controlName + '$Image" src="' + this.ImageLocation + '" unselectable="on" style="position:absolute;top:0px;left:' + (this.Clockwise ? 0 : -this.Length) + 'px" />',
                                                               Parent: __pageNode
                                                             });
                
                __imageNode = document.getElementById(__controlName + "$Image");
                
                this.Created = true;
                
                this.Show();
                
                this.Start();
                
                if (typeof this.OnAfterLoad == "function")
                {
                    this.OnAfterLoad(this);
                }
            }
        }
    }
    
    ___LoadResourceXml(this.ResourcePath, __resource, this, ___ParseResourceXmlCallback);
}

if (typeof Spinner == "undefined")
{
    Spinner = __System.Controls.UI.Spinner;
}

__System.Import("System.Controls.UI.Spinner", true);
