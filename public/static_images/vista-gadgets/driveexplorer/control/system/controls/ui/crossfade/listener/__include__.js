////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Collections.Generic.List");

__System.Controls.UI.CrossFade.Listener = function(/*Object*/ control)
{
    var __control = control;
    var __children = new __System.Collections.Generic.List();
    var __configuration = new __System.Collections.Generic.List();
    var __this = this;
    
    this.Count = 0;
    
    function ___Properties(/*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Internal procedure to create data access features.
        //
        // arguments:
        //   index (optional)
        //   count (optional)
        //
        // returns: Nothing
        
        var n = __this.Count;
        __this.Count = __children.Count;

        count = (count != null ? Math.min(index + count, __this.Count) : __this.Count);
        
        for (var i = (index != null ? index : 0); i < count; i++)
        {
            __this[i] = __children[i];
        }
        
        for (var i = __this.Count; i < n; i++)
        {
            delete __this[i];
        }
    }
    
    function ___SetConfig(/*Object*/ control, /*String*/ configVar)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   control (required)
        //   configVar (required)
        //
        // returns: Nothing
        
        try
        {
            eval(control.ControlName.get() + "." + configVar + " = __control." + configVar + ";");
        }
        catch (e)
        {
        }
    }
    
    this.Add = function(/*Object*/ control)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   control (required)
        //
        // returns: Boolean
        
        var n = __children.IndexOf(control);
        
        if (n == -1)
        {
            control.Parent = __control;
            __children.Add(control);
            
            ___Properties(this.Count);
            
            return true;
        }
        
        return false
    }
    
    this.Inherit = function(/*String*/ configVar)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   configVar (required)
        //
        // returns: Nothing
        
        var n = __configuration.IndexOf(configVar);
        
        if (n == -1)
        {
            __configuration.Add(configVar);
        }
    }
    
    this.Remove = function(/*Object*/ control)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   control (required)
        //
        // returns: Boolean
        
        var n = __children.IndexOf(control);
        
        if (n != -1)
        {
            __children.RemoveAt(n);
            
            ___Properties();
            
            return true;
        }
        
        return false;
    }
    
    this.Update = function(/*Object*/ control)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   control (required)
        //
        // returns: Nothing
        
        var b = false;
        
        try
        {
            b = control._USER.Vars.inheritConfig;
        }
        catch (e)
        {
        }
        
        if (b)
        {
            var o = __configuration.GetEnumerator();
            
            while (o.MoveNext())
            {
                ___SetConfig(control, __configuration[o.Current]);
            }
        }
    }
    
    this.UpdateAll = function()
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        var o = __children.GetEnumerator();
        
        while (o.MoveNext())
        {
            if (__children[o.Current].Inherit)
            {
                var o1 = __configuration.GetEnumerator();
                
                while (o1.MoveNext())
                {
                    ___SetConfig(__children[o.Current], __configuration[o1.Current]);
                }
            }
        }
    }
    
    this.Eval = function(/*String*/ proc)
    {
        // summary:
        //  
        //  
        //
        // arguments:
        //   procedure (required)
        //
        // returns: Nothing
        
        proc += "(";
        
        for (var i = 1; i < arguments.length; i++)
        {
            proc += (i > 1 ? ", " : "") + "arguments[" + i + "]";
        }
        
        proc += ")";
        
        var o = __children.GetEnumerator();
        
        while (o.MoveNext())
        {
            try
            {
                eval("__children[o.Current]." + proc + ";");
            }
            catch (e)
            {
            }
        }
    }
}

__System.Import("System.Controls.UI.CrossFade.Listener", true);
