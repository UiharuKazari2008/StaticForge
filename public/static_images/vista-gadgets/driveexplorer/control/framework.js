////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

if (typeof __System == "undefined")
{
    __System = new function()
    {
        var __this = this;
        
        var __loadedModules = [];
        var __moduleFilename = "__INCLUDE__.js";
        var __moduleLoadingCount = 0;
        var __modulePending = [];
        var __moduleRequiredMap = [];
        
        __moduleRequiredMap["System.Controls.Event"] = [
            ["System.Collections.Generic.List"],
            []
        ];
        __moduleRequiredMap["System.Collections.Generic.List"] = [
            [],
            ["System.Controls.Event"]
        ];
        
        this.Locale = "en-US";
        this.ResourceFilename = "Default.xml";
        this.ResourceKeyIndex = new Date().getTime();
        this.UseXMLHTTP = true;
        
        function ___BuildModulePath(/*String*/ moduleName)
        {
            var s = __this.BasePath;
            var o = moduleName.split(".");
            
            for (var i = 0; i < o.length; i++)
            {
                if (o[i] != "*")
                {
                    s += o[i].toLowerCase() + "/";
                }
                else
                {
                    break;
                }
            }
            
            s += __moduleFilename;
            
            return s;
        }
        
        function ___IsRequiredModulesLoaded(/*String*/ moduleName)
        {
            if (__moduleRequiredMap[moduleName] != null && __moduleRequiredMap[moduleName][0].length > 0)
            {
                for (var i = 0; i < __moduleRequiredMap[moduleName][0].length; i++)
                {
                    if (!__System.IsModuleLoaded(__moduleRequiredMap[moduleName][0][i]))
                    {
                        return false;
                    }
                }
            }
            
            return true;
        }
        
        this.BasePath = (function()
        {
            var o = document.getElementsByTagName("SCRIPT");
            
            for (var i = 0; i < o.length; i++)
            {
                var n = o[i].src.match(/framework.js/i);
                
                if (n != null)
                {
                    return o[i].src.substring(0, n.index);
                }
            }
            
            return "";
        })();
        
        this.IsFrameworkLoaded = function()
        {
            return (__moduleLoadingCount == 0);
        }
        
        this.IsModuleLoaded = function(/*String*/ moduleName)
        {
            return (__loadedModules[moduleName] == true);
        }
        
        this.Import = function(/*String*/ moduleName, /*Boolean*/ loaded)
        {
            if (loaded && __loadedModules[moduleName] != null && !__loadedModules[moduleName])
            {
                __moduleLoadingCount--;
                __loadedModules[moduleName] = true;
                
                if (!__System.UseXMLHTTP)
                {
                    if (__moduleRequiredMap[moduleName] != null && __moduleRequiredMap[moduleName][1].length > 0)
                    {
                        for (var i = 0; i < __moduleRequiredMap[moduleName][1].length; i++)
                        {
                            if (__modulePending[__moduleRequiredMap[moduleName][1][i]] != null)
                            {
                                delete __modulePending[__moduleRequiredMap[moduleName][1][i]];
                                this.Import(__moduleRequiredMap[moduleName][1][i]);
                            }
                        }
                    }
                }
            }
            else if (!__System.UseXMLHTTP && !___IsRequiredModulesLoaded(moduleName))
            {
                __modulePending[moduleName] = true;
            }
            else if (moduleName != null && __loadedModules[moduleName] == null)
            {
                var nameSpace = moduleName.split(".");
                var systemPath = "__this";
                
                for (var i = 1; i < nameSpace.length; i++)
                {
                    if (nameSpace[i] != "*")
                    {
                        systemPath += "." + nameSpace[i];
                        
                        if (eval(systemPath) == null)
                        {
                            eval(systemPath + " = {};");
                        }
                    }
                    else
                    {
                        break;
                    }
                }
                
                __moduleLoadingCount++;
                __loadedModules[moduleName] = false;
                
                var modulePath = ___BuildModulePath(moduleName);
                
                if (this.UseXMLHTTP)
                {
                    var response = ___OpenXmlHttp(modulePath);
                    
                    if (response != null)
                    {
                        try
                        {
                            eval(response);
                        }
                        catch (e)
                        {
                        }
                        
                        return;
                    }
                }
                
                var bodyNode = document.getElementsByTagName("BODY");
                
                if (bodyNode[0] != null)
                {
                    var scriptNode = document.createElement("SCRIPT");
                    
                    with (scriptNode)
                    {
                        src = modulePath;
                        language = "javascript";
                        type = "text/javascript";
                    }
                    
                    bodyNode[0].appendChild(scriptNode);
                }
                else
                {
                    document.write('<script src="' + modulePath + '" language="javascript" type="text/javascript"></script>');
                }
            }
        }
        
        this.Object =
        {
            Equals: function(/*Object*/ obj0, /*Object*/ obj1)
            {
                // summary:
                //   Determines whether two Object instances are equal.
                //
                // arguments:
                //   obj0 (required)
                //   obj1 (optional)
                //
                // returns: Boolean
                
                return ((obj0 != null && obj1 != null) && typeof obj0 == typeof obj1 && obj0 == obj1);
            },
            ReferenceEquals: function(/*Object*/ obj0, /*Object*/ obj1)
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
                
                return ((obj0 != null && obj1 != null) && typeof obj0 == "object" && typeof obj0 == typeof obj1 && obj0 == obj1);
            }
        }
    }
    
    __System.Import("System.Type");
    __System.Import("System.Convert");
}

function ___BuildResourcePath(/*String*/ resource)
{
     return resource + (resource.substring(resource.lastIndexOf("/")).indexOf(".") == -1 ? (resource.charAt(resource.length - 1) != "/" ? "/" : "") + __System.ResourceFilename : "");            
}

function ___CreateNamespace(/*Control*/ control, /*String*/ name)
{
    var o = name.split(".");
    var s = "control";
    
    for (var i = 1; i < o.length - 1; i++)
    {
        s += "." + o[i];
        
        if (eval(s) == null)
        {
            eval(s + " = {};");
        }
    }
}

function ___IsChildrenResourceParsing(/*Object*/ resource)
{
    for (var i = 0; i < resource.Children.length; i++)
    {
        if (resource.Children[i].Parsing.get())
        {
            return true;
        }
    }
    
    return false;
}

function ___LoadResourceXml(/*String*/ path, /*Object*/ resource, /*Control*/ control, /*Function*/ callback)
{
    if (path != null)
    {
        var curPath = ___BuildResourcePath(path);
        
        if (resource.Children != null)
        {
            for (var i = 0; i < resource.Children.length; i++)
            {
                resource.Children[i].Load(true);
            }
        }
        
        if (resource.Path != curPath)
        {
            if (typeof callback == "function")
            {
                resource.Path = curPath;
                
                if (__System.UseXMLHTTP)
                {
                    var response = ___OpenXmlHttp(resource.Path, null, true);
                    
                    if (response != null)
                    {
                        resource.Xml = new ActiveXObject("Microsoft.XMLDOM");
                        resource.Xml.load(resource.Path);
                        
                        callback(resource, control);
                    }
                    else
                    {
                        return false;
                    }
                }
                else
                {
                    if (control != null)
                    {
                        resource.Xml = new ActiveXObject("Microsoft.XMLDOM");
                        resource.Parsing = true;
                        
                        with (resource.Xml)
                        {
                            onreadystatechange = function()
                            {
                                if (resource.Xml.readyState == 4)
                                {
                                    callback(resource, control);
                                }
                            }
                            
                            load(resource.Path);
                        }
                    }
                    else
                    {
                        return false;
                    }
                }
            }
            else
            {
                return false;
            }
        }
    }
     
    return true;
}

function ___OpenXmlHttp(/*String*/ resource, /*Function*/ callback, /*Boolean*/ useXML)
{
    var httpReq = new ActiveXObject("Msxml2.XMLHTTP");
    
    if (callback != null)
    {
        httpReq.onreadystatechange = function()
        {
            if (httpReq.readyState == 4)
            {
	            callback(httpReq.responseText);
            }
        }
    }
    
    var error = false;
    
    try
    {
        httpReq.open("GET", resource, (callback != null));
        httpReq.send(null);
    }
    catch (e)
    {
        error = true;
    }
    
    return (!error ? (useXML ? httpReq.responseXML : httpReq.responseText) : null);
}

function ___ParseLocaleXml(/*XmlDocument*/ xml)
{
    var result = [];
    
    if (xml != null)
    {
        var nodes = xml.getElementsByTagName("locale");
        
        for (var i = 0; i < nodes.length; i++)
        {
            var lang = (nodes[i].getAttribute("lang") != null ? nodes[i].getAttribute("lang") : (i == 0 ? "default" : null));
            
            if (lang != null)
            {
                result[lang.toLowerCase()] = {};
                ___RecurseChildNodes(result[lang.toLowerCase()], "", nodes[i]);
            }
        }
    }
    
    return result;
}        

function ___ParseLocaleXmlCallback(/*Object*/ locale, /*Control*/ control, /*Boolean*/ useLoad)
{
    if (locale.Xml != null)
    {
        var result = ___ParseLocaleXml(locale.Xml);
        
        control.Locale.set(null, null, result);
        
        locale.Xml = null;
        locale.Parsing = false;
        
        if (useLoad)
        {
            control.Load();
        }
    }
}

function ___ParseResourceXml(/*Object*/ resource, /*Control*/ control)
{
    var result = [];
    result[__System.ResourceKeyIndex] = [];
    
    if (resource.Xml != null)
    {
        var nodes = resource.Xml.getElementsByTagName("resource");
        
        for (var i = 0; i < nodes.length; i++)
        {
            switch (nodes[i].getAttribute("type").toLowerCase())
            {
                case "image":
                    var path = (nodes[i].getAttribute("absolutePath") != null ? nodes[i].getAttribute("absolutePath") : (nodes[i].getAttribute("relativePath") != null ? control.ResourcePath + nodes[i].getAttribute("relativePath") : control.ResourcePath));
                    var prefix = (nodes[i].getAttribute("prefix") != null ? nodes[i].getAttribute("prefix") : "");
                    var ext = (nodes[i].getAttribute("extension") != null ? nodes[i].getAttribute("extension") : "");
                    
                    if (path.charAt(path.length - 1) != "/")
                    {
                        path += "/";
                    }
                    
                    for (var j = 0; j < nodes[i].childNodes.length; j++)
                    {
                        var node = nodes[i].childNodes.item(j);
                        
                        if (node.getAttribute("name") != null)
                        {
                            result[node.getAttribute("name")] =
                            {
                                Path: path,
                                Prefix: prefix,
                                Name: node.getAttribute("name"),
                                RTL: (node.getAttribute("rtl") != null ? node.getAttribute("rtl") : ""),
                                Extension: ext,
                                State: (node.getAttribute("state") != null ? node.getAttribute("state") : []),
                                Width: parseInt(node.getAttribute("width")),
                                Height: parseInt(node.getAttribute("height")),
                                Build: function (/*Integer*/ index, /*Boolean*/ rightToLeft)
                                {
                                    return this.Path + this.Prefix + this.Name + (index != null ? (typeof this.State == "string" ? (result[this.State].State[index] != null ? result[this.State].State[index] : "") : (this.State[index] != null ? this.State[index] : "")) : "") + (rightToLeft ? this.RTL : "") + "." + this.Extension;
                                }
                            };
                            
                            for (var k = 0; k < node.childNodes.length; k++)
                            {
                                var o = node.childNodes.item(k);
                                
                                if (o.nodeName == "State")
                                {
                                    if (typeof result[node.getAttribute("name")].State != "string")
                                    {
                                        if (o.getAttribute("index") != null)
                                        {
                                            result[node.getAttribute("name")].State[o.getAttribute("index")] = o.text;
                                        }
                                        else
                                        {
                                            result[node.getAttribute("name")].State.push(o.text);
                                        }
                                    }
                                }
                                else
                                {
                                    try
                                    {
                                        eval("result[node.getAttribute(\"name\")]." + o.nodeName + " = __System.Convert.To" + (o.getAttribute("type") != null ? o.getAttribute("type") : "String") + "('" + o.text.replace(/\'/g, "\\'") + "');");
                                    }
                                    catch (e)
                                    {
                                    }
                                }
                            }
                            
                            result[__System.ResourceKeyIndex].push(node.getAttribute("name"));
                        }
                    }
                    
                    break;
                case "control":
                    var name = (nodes[i].getAttribute("name") != null ? "." + nodes[i].getAttribute("name") : "");
                    var obj = eval("control" + name);
                    var found = (obj == control);
                    
                    if (!found)
                    {
                        for (var j = 0; j < resource.Children.length; j++)
                        {
                            if (obj == resource.Children[j])
                            {
                                found = true;
                                break;
                            }
                        }
                    }
                    
                    if (found)
                    {
                        ___RecurseChildNodes(control, name, nodes[i]);
                        eval("control" + name + ".ResourcePath = (nodes[i].getAttribute(\"absolutePath\") != null ? nodes[i].getAttribute(\"absolutePath\") : (nodes[i].getAttribute(\"relativePath\") != null ? control.ResourcePath + nodes[i].getAttribute(\"relativePath\") : control" + name + ".ResourcePath));");
                    }
                    break;
            }
        }
    }
    
    return result;
}

function ___ParseResourceXmlCallback(/*Object*/ resource, /*Control*/ control, /*Boolean*/ useLoad)
{
    if (resource.Xml != null && control != null)
    {
        var result = ___ParseResourceXml(resource, control);
        
        control.Resources.set(result);
        
        resource.Xml = null;
        resource.Parsing = false;
        
        if (useLoad)
        {
            control.Load();
        }
    }
}

function ___RecurseChildNodes(/*Control*/ control, /*String*/ name, /*XmlNodes*/ nodes)
{
    for (var i = 0; i < nodes.childNodes.length; i++)
    {
        var o = nodes.childNodes.item(i);
        
        if (o.childNodes.length > 0)
        {
            ___RecurseChildNodes(control, name + "." + o.nodeName, o);
        }
        else
        {
            try
            {
                ___CreateNamespace(control, name);
                eval("control" + name + " = __System.Convert.To" + (o.parentNode.getAttribute("type") != null ? o.parentNode.getAttribute("type") : "String") + "('" + o.text.replace(/\'/g, "\\'") + "');");
            }
            catch (e)
            {
            }
        }
    }
}

function ___RemoveEventMouseClick(/*Control*/ control)
{
    __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseDown, control);
    __System.Threading.Monitor.Exit(__System.Controls.EventType.MouseUp, control);
}

function ___TryEventMouseClick(/*Control*/ control)
{
    if (__System.Threading.Monitor.TryEnter(__System.Controls.EventType.MouseDown, control) && __System.Threading.Monitor.TryEnter(__System.Controls.EventType.MouseUp, control))
    {
         return true;
    }
    else
    {
        ___RemoveEventMouseClick(control);
        
        return false;
    }
}

function ___TryObjectProperty(/*Object*/ obj)
{
    if (obj != null)
    {
        var s = "obj";
        
        for (var i = 1; i < arguments.length; i++)
        {
            s += "[arguments[" + i + "]]";
        }
        
        try
        {
            var o = eval(s);
            return o;
        }
        catch (e)
        {
            return null;
        }
    }
    
    return obj;
}
