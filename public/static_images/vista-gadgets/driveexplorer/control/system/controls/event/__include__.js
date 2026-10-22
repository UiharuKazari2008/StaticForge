////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Import("System.Collections.Generic.List");

__System.Controls.Event = new function()
{
    var __pageEvents = [];
    var __pageEventMap = (function()
    {
        var o = new __System.Collections.Generic.List();
        
        o.Add(["MouseEnter", "document.onmouseenter"]);
        o.Add(["MouseLeave", "document.onmouseleave"]);
        o.Add(["MouseDown", "document.onmousedown"]);
        o.Add(["MouseUp", "document.onmouseup"]);
        o.Add(["MouseMove", "document.onmousemove"]);
        o.Add(["MouseWheel", "document.onmousewheel"]);
        o.Add(["KeyUp", "document.onkeyup"]);
        o.Add(["KeyDown", "document.onkeydown"]);
        o.Add(["KeyPress", "document.onkeypress"]);
        o.Add(["FocusIn", "document.onfocusin"]);
        o.Add(["FocusOut", "document.onfocusout", true]);
        
        return o;
    })();
    var __savedEvents = [];
    
    function ___PageEventHandler(/*String*/ index)
    {
        eval(__pageEventMap[index][1] + ' = function(/*Event*/ evt)' +
            '{' +
            '   evt = (evt != null ? evt : event);' +
            
            '   if (__savedEvents[__pageEventMap[index][0]] != null)' +
            '   {' +
            '       __savedEvents[__pageEventMap[index][0]](evt);' +
            '   }' +
            
            '   var control = null;' +
            
            '   if (__System.IsModuleLoaded("System.Threading.Monitor"))' +
            '   {' +
            '       control = __System.Threading.Monitor._Current(__System.Controls.EventType[__pageEventMap[index][0]]);' +
            
            '       if (control != null)' +
            '       {' +
            '           if (typeof control._EVENTS[__pageEventMap[index][0]] == "function")' +
            '           {' +
            '               control._EVENTS[__pageEventMap[index][0]](evt);' +
            '           }'+
            '       }' +
            '   }' +
            
            '   if (__pageEvents[__pageEventMap[index][0]] != null && __pageEvents[__pageEventMap[index][0]].Count > 0)' +
            '   {' +
                    (__pageEventMap[index][2] ? "var o = [];" : "") +
            
            '       for (var i = 0; i < __pageEvents[__pageEventMap[index][0]].Count; i++)' +
            '       {' +
            '           if (__pageEvents[__pageEventMap[index][0]][i] != null && __pageEvents[__pageEventMap[index][0]][i] != control)' +
            '           {' +
                            (__pageEventMap[index][2] ? "var n = " : "") + '__pageEvents[__pageEventMap[index][0]][i]._EVENTS[__pageEventMap[index][0]](evt, true);' +
            
                            (__pageEventMap[index][2] ? "if (n != null)" +
                                                        "{" +
                                                            "o.push([__pageEvents[__pageEventMap[index][0]][i], n]);" +
                                                        "}" : "") +
            '           }' +
            '       }' +
            
                (__pageEventMap[index][2] ? "if (o.length > 0)" +
                                            "{" +
                                                "control = (o.length > 1 ? ___FindRootControl(o) : o[0][0]);" +
            
                                                "if (control != null)" +
                                                "{" +
                                                    "control._EVENTS[__pageEventMap[index][0]](evt, true, true);" +
                                                "}" +
                                             "}" : "") +
            '   }' +
            '}');
    }
    
    function ___FindRootControl(/*Array*/ controls)
    {
        var root = [];
        var base = [];
        var n = -1;
        
        for (var i = 0; i < controls.length; i++)
        {
            if (controls[i][1] < n || n == -1)
            {
                root = [controls[i][0]];
                n = controls[i][1];
            }
            else if (controls[i][1] == n)
            {
                root.push(controls[i][0]);
            }
            
            base[controls[i][0].ControlName.get()] = 0;
        }
        
        if (root.length > 1)
        {
            for (var i = 0; i < root.length; i++)
            {
                if (root[i].Parent != null && base[root[i].Parent.ControlName.get()] != null)
                {
                    base[root[i].Parent.ControlName.get()]++;
                }
            }
            
            var o = [];
            var n = 0;
            
            for (var i = 0; i < root.length; i++)
            {
                if (base[root[i].ControlName.get()] > n)
                {
                    o = [root[i]];
                    n = base[root[i].ControlName.get()];
                }
                else if (base[root[i].ControlName.get()] == n)
                {
                    o.push(root[i]);
                }
            }
            
            return (o.length == 1 ? o[0] : null);
        }
        else
        {
            return root[0];
        }
    }
    
    (function()
    {
        __System.Controls.EventType = {};
        
        var o = __pageEventMap.GetEnumerator();
        
        while (o.MoveNext())
        {
            __System.Controls.EventType[__pageEventMap[o.Current][0]] = 1 << o.Current;
        }
    })();
    
    this.Add = function(/*Object*/ control, /*Integer*/ events)
    {
        if (control._EVENTS)
        {
            for (var proc in control["_EVENTS"])
            {
                var n = __pageEventMap.FindIndex( function(o)
                                                  {
                                                      return (o[0] == proc);
                                                  } );
                if (n != -1)
                {
                    if (__pageEvents[proc] == null)
                    {
                        __pageEvents[proc] = new __System.Collections.Generic.List();
                        eval("__savedEvents[proc] = " + __pageEventMap[n][1]);
                        ___PageEventHandler(n);
                    }
                    
                    if ((events & __System.Controls.EventType[proc]) == __System.Controls.EventType[proc])
                    {
                        if (__pageEvents[proc].IndexOf(control) == -1)
                        {
                            __pageEvents[proc].Add(control);
                            ___PageEventHandler(n);
                        }
                    }
                }
            }
        }
    }
    
    this.Remove = function(/*Object*/ control, /*Integer*/ events)
    {
        if (events != null)
        {
            for (var proc in control["_EVENTS"])
            {
                if (__pageEvents[proc] != null)
                {
                    var n = __pageEventMap.FindIndex( function(o)
                                                      {
                                                          return (o[0] == proc);
                                                      } );
                    if (n != -1)
                    {
                        if ((events & __System.Controls.EventType[proc]) == __System.Controls.EventType[proc])
                        {
                            __pageEvents[proc].Remove(control);
                            ___PageEventHandler(n);
                            
                            if (__System.IsModuleLoaded("System.Threading.Monitor"))
                            {
                                __System.Threading.Monitor.Exit(__System.Controls.EventType[proc], control);
                            }
                        }
                    }
                }
            }
        }
        else
        {            
            var o = __pageEventMap.GetEnumerator();
            
            while (o.MoveNext())
            {
                if (typeof __pageEvents[__pageEventMap[o.Current][0]] != "undefined")
                {
                    var n = __pageEvents[__pageEventMap[o.Current][0]].IndexOf(control);
                    
                    if (n != -1)
                    {
                        __pageEvents[__pageEventMap[o.Current][0]].RemoveAt(n);
                        ___PageEventHandler(o.Current);
                    }
                }
                
                if (__System.IsModuleLoaded("System.Threading.Monitor"))
                {
                    __System.Threading.Monitor.Exit(__System.Controls.EventType[__pageEventMap[o.Current][0]], control);
                }
            }
        }
    }
}

__System.Import("System.Controls.Event", true);
