////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.Components.TreeNodeCollection = function()
{
    var __key = [];
    var __ordered = [];
    var __orderedKeyIndex = [];
    var __unordered = [];
    var __this = this;
    
    this.Count = 0;
    this.Empty = false;
    this.Keys = [];
    
    function ___FindKeyIndex(/*Object*/ key)
    {
        // summary:
        //   Internal procedure to find the index of a key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Integer
        
        for (var i = 0; i < __orderedKeyIndex.length; i++)
        {
            if (__orderedKeyIndex[i] == key)
            {
                return i;
            }
        }
        
        return -1;
    }
    
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
        
        __this.Count = __ordered.length;
        
        count = (count != null ? Math.min(index + count, this.Count) : __this.Count);
        
        for (var i = (index != null ? index : 0); i < count; i++)
        {
            __this[i] = __ordered[i];
            __this.Item[i] =
            {
                index: i,
                get: function()
                {
                    return __ordered[this.index];
                },
                set: function(/*Object*/ value)
                {
                    __ordered[this.index] = value;
                    
                    if (__orderedKeyIndex[this.index] != null)
                    {
                        __unordered[__orderedKeyIndex[this.index]] = value;
                    }
                }
            }
        }
        
        for (var i = __this.Count; i < n; i++)
        {
            delete __this[i];
            delete __this.Item[i];
        }
        
        __this.Keys = [];
        
        for (var i = 0; i < __key.length; i++)
        {
            __this.Keys[i] = __key[i];
        }
        
        __this.Empty = (__this.Count > 0 || __key.length > 0);
    }
    
    function ___RemoveKey(/*Object*/ key)
    {
        // summary:
        //   Internal procedure to remove a key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Nothing
        
        var n = -1;
        
        for (var i = 0; i < __key.length; i++)
        {
            if (__key[i] == key)
            {
                __key.splice(n, 1);
                break;
            }
        }
        
        __unordered[key] = null;
        delete __unordered[key];
    }
    
    function ___SetKeyName(/*Integer*/ index, /*String*/ key)
    {
        // summary:
        //   Internal procedure to set the key for a node in
        //   the collection.
        //
        // arguments:
        //   index (required)
        //   key (required)
        //
        // returns: Nothing
        
        if (key != null)
        {
            if (index >= 0 && index < __this.Count)
            {
                if (__orderedKeyIndex[index] != null && __orderedKeyIndex[index] != key)
                {
                    ___RemoveKey(__orderedKeyIndex[index]);
                }
                
                __orderedKeyIndex[index] = key;
                
                if (!this.ContainsKey(key))
                {
                    __key.push(key);
                }
                
                __unordered[key] = __ordered[index];
            }
        }
    }
    
    ___Properties();
    
    this.Enumerator = function()
    {
        // summary:
        //   Enumerates the elements of a TreeNodeCollection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        this.Count = __this.Count;
        this.Current = -1;
        
        this.MoveNext = function()
        {
            if (this.Current < this.Count - 1)
            {
                this.Current++;
                return true;
            }
            
            return false;
        }
        
        this.Reset = function()
        {
            this.Current = -1;
        }
    }
    
    this.Item = {
    
    }
    
    this.Add = function(/*String|TreeNode*/ node)
    {
        // summary:
        //   Adds a new tree node to the collection.
        //
        // arguments:
        //   node (required)
        //
        // returns: Nothing
        
        if (typeof node != "undefined")
        {
            this.Insert(this.Count, node, arguments[1], arguments[2], arguments[3]);
        }
    }
    
    this.AddRange = function(/*Array*/ collection)
    {
        // summary:
        //   Adds an array of previously created tree nodes
        //   to the collection.
        //
        // arguments:
        //   collection (required)
        //
        // returns: Nothing
        
        if (collection != null)
        {
            var b = true;
            
            if (collection.splice != null || collection.Enumerator != null)
            {
                b = false;
                
                var nodes = [];
                
                if (collection.Enumerator != null)
                {
                    try
                    {
                        var o = collection.GetEnumerator();
                        
                        while (o.MoveNext())
                        {
                            nodes.push(o.Item[o.Current].get());
                        }
                    }
                    catch (e)
                    {
                        b = true;
                    }
                }
                else
                {
                    nodes = collection;
                }
                
                if (!b)
                {
                    for (var i = 0; i < nodes.length; i++)
                    {
                        this.Add(nodes[i]);
                    }
                }
            }
            
            if (b)
            {
                this.Add(collection);
            }
        }
    }
    
    this.Clear = function()
    {
        // summary:
        //   Removes all tree nodes from the collection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __ordered = [];
        __orderedKeyIndex = [];
        __key = [];
        __unordered = [];
        
        this.Item = {};
        
        ___Properties();
    }
    
    this.Contains = function(/*Object*/ node)
    {
        // summary:
        //   Determines whether the specified tree node is a member
        //   of the collection.
        //
        // arguments:
        //   item (required)
        //
        // returns: Boolean
        
        if (typeof node != "undefined")
        {
            return (this.IndexOf(node) != -1);
        }
        
        return false;
    }
    
    this.ContainsKey = function(/*Object*/ key)
    {
        // summary:
        //   Determines whether the collection contains a tree node
        //   with the specified key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Boolean
        
        if (typeof key != "undefined")
        {
            return (typeof __unordered[key] != "undefined");
        }
        
        return false;
    }
    
    this.CopyTo = function(/*Array*/ collection, /*Integer*/ index)
    {
        // summary:
        //   Copies the entire collection into an existing array at a
        //   specified location within the array.
        //
        // arguments:
        //   collection (required)
        //   index (required)
        //
        // returns: Nothing
        
        if (collection != null && collection.splice != null && index != null)
        {
            for (var i = 0; i < this.Count; i++)
            {
                collection[i + index] = __ordered[i];
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
        
        if (obj0.Count == obj1.Count && obj0.Keys.length == obj1.Keys.length)
        {
            for (var i = 0; i < obj0.Count; i++)
            {
                if (obj0[i] != obj1[i] || typeof obj0[i] != typeof obj1[i])
                {
                    return false;
                }
            }
            
            for (var i = 0; i < obj0.Keys.length; i++)
            {
                if (obj0.Keys[i] != obj1.Keys[i] || typeof obj0.Keys[i] != typeof obj1.Keys[i])
                {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
    
    this.Find = function(/*String*/ key, /*Boolean*/ search)
    {
        // summary:
        //   Finds the tree nodes with specified key, optionally
        //   searching subnodes.
        //
        // arguments:
        //   key (required)
        //   search (optional)
        //
        // returns: Object
        
        var o = [];
        
        if (typeof key != "undefined")
        {
            for (var i = 0; i < this.Count; i++)
            {
                if (__orderedKeyIndex[i] == key)
                {
                    o.push(__ordered[i]);
                }
                
                if (search)
                {
                    o.concat(__ordered[i].Find(key, true));
                }
            }
        }
        
        return o;
    }
    
    this.GetEnumerator = function()
    {
        // summary:
        //   Returns an enumerator that can be used to iterate
        //   through the tree node collection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.IndexOf = function(/*Object*/ node, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Returns the index of the specified tree node in
        //   the collection.
        //
        // arguments:
        //   node (required)
        //   index (optional)
        //   count (optional)
        //
        // returns: Integer
        
        if (typeof node != "undefined")
        {
            index = (index != null ? parseInt(index) : 0);
            var end = this.Count;
            
            if (index < 0 || index > this.Count - 1)
            {
                return -1;
            }
            
            if (count != null)
            {
                count = parseInt(count);
                
                if (count < 0)
                {
                    return -1;
                }
                
                end = Math.min(index + count, this.Count);
            }
            
            for (var i = index; i < end; i++)
            {
                if (__ordered[i] == node && typeof __ordered[i] == typeof node)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    this.IndexOfKey = function(/*Object*/ key)
    {
        // summary:
        //   Returns the index of the first occurrence of a tree node
        //   with the specified key.
        //
        // arguments:
        //   key (required)
        //
        // returns: Integer
        
        if (typeof key != "undefined")
        {
            for (var i = 0; i < this.Count; i++)
            {
                if (__orderedKeyIndex[i] == key && typeof __orderedKeyIndex[i] == typeof key)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    this.Insert = function(/*Integer*/ index, /*TreeNode|String*/ node)
    {
        // summary:
        //   Inserts an item in the collection at a specified location.
        //
        // arguments:
        //   index (required)
        //   node (required)
        //
        // returns: Nothing
        
        if (index != null && typeof node != "undefined")
        {
            if (index >= 0)
            {
                index = Math.min(index, this.Count);
                
                if (typeof node != "object")
                {
                    __System.Import("System.Controls.UI.Components.TreeNode");
                    
                    if (typeof node == "string" && typeof arguments[2] == "string")
                    {
                        if (typeof node != "number" && parseInt(node).toString() != node.toString())
                        {
                            ___SetKeyName(index, node);
                        }
                        
                        node = new __System.Controls.UI.Components.TreeNode(arguments[2], arguments[3], arguments[4], arguments[5]);
                    }
                    else
                    {
                        node = new __System.Controls.UI.Components.TreeNode(node, arguments[2], arguments[3], arguments[4]);
                    }
                }
                
                __ordered.splice(index, 0, node);
                __orderedKeyIndex.splice(index, 0, null);
                
                ___Properties();
            }
        }
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
    
    this.Remove = function(/*Object*/ node)
    {
        // summary:
        //   Removes the specified tree node from the tree node
        //   collection.
        //
        // arguments:
        //   node (required)
        //
        // returns: Nothing
        
        if (typeof item != "undefined")
        {
            var n = this.IndexOf(node);
            
            if (n != -1)
            {
                this.RemoveAt(n);
            }
        }
    }
    
    this.RemoveAt = function(/*Integer*/ index)
    {
        // summary:
        //   Removes a tree node from the tree node collection at
        //   a specified index.
        //
        // arguments:
        //   index (required)
        //
        // returns: Nothing
        
        if (index != null)
        {
            if (index >= 0 && index < this.Count)
            {
                if (__orderedKeyIndex[index] != null)
                {
                    this.RemoveByKey(__orderedKeyIndex[index]); 
                }
                else
                {
                    __ordered.splice(index, 1);
                }
                
                ___Properties(index);
            }
        }
    }
    
    this.RemoveByKey = function(/*String*/ key)
    {
        // summary:
        //   Removes the tree node with the specified key from
        //   the collection.
        //
        // arguments:
        //   key (required)
        //
        // returns: Nothing
        
        if (key != null)
        {
            if (this.ContainsKey(key))
            {
                ___RemoveKey(key);
                
                var n = ___FindKeyIndex(key);
                
                if (n != -1)
                {
                    this.RemoveAt(n);
                }
            }
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
        
        var s = "";
        var o = this.GetEnumerator();
        
        while (o.MoveNext())
        {
            s += "," + __ordered[o.Current].Text;
        }
        
        return s;
    }
}

if (typeof TreeNodeCollection == "undefined")
{
    TreeNodeCollection = __System.Controls.UI.Components.TreeNodeCollection;
}

__System.Import("System.Controls.UI.Components.TreeNodeCollection", true);
