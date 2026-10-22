////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Threading.Monitor = new function()
{
    var __monitor = [];
    
    this.Enter = function(/*Object*/ obj, /*Object*/ context)
    {
        // summary:
        //   Acquires an exclusive lock on the specified object.
        //
        // arguments:
        //  obj (required)
        //  context (required)
        //
        // returns: Nothing
        
        if (typeof obj != "undefined" && context != null)
        {
            if (__monitor[obj] == null)
            {
                __monitor[obj] = context;
            }
        }
    }
    
    this.Exit = function(/*Object*/ obj, /*Object*/ context)
    {
        // summary:
        //   Releases an exclusive lock on the specified object.
        //
        // arguments:
        //  obj (required)
        //  context (required)
        //
        // returns: Nothing
        
        if (typeof obj != "undefined" && context != null)
        {
            if (__monitor[obj] == context)
            {
                __monitor[obj] = null;
            }
        }
    }
    
    this.TryEnter = function(/*Object*/ obj, /*Object*/ context)
    {
        // summary:
        //   Attempts to acquire an exclusive lock on the specified object.
        //
        // arguments:
        //  obj (required)
        //  context (required)
        //
        // returns: Boolean
        
        if (typeof obj != "undefined" && context != null)
        {
            if (this._IsAvailable(obj, context) || this._Current(obj) == context)
            {
                __monitor[obj] = context;
                return true;
            }
        }
        
        return false;
    }
    
    this._Current = function(/*Object*/ obj)
    {
        // summary:
        //   Returns the current context holder of the monitor.
        //
        // arguments:
        //  obj (required)
        //
        // returns: Nothing
        
        if (typeof obj != "undefined")
        {
            return __monitor[obj];
        }
    }
    
    this._IsAvailable = function(/*Object*/ obj)
    {
        // summary:
        //   Determines if the monitor is available to be used.
        //
        // arguments:
        //  obj (required)
        //
        // returns: Boolean
        
        if (typeof obj != "undefined")
        {
            if (__monitor[obj] == null)
            {
                return true;
            }
        }
        
        return false;
    }
}

__System.Import("System.Threading.Monitor", true);
