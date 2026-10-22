////////////////////////////////////////////////////////////////////////////////
//
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
//
////////////////////////////////////////////////////////////////////////////////

__System.Controls.UI.ListBox.ObjectCollection = function()
{
    var __ordered = [];
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
        
        __this.Count = __ordered.length;
        
        count = (count != null ? Math.min(index + count, __this.Count) : __this.Count);
        
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
                    __this[this.index] = value;
                }
            }
        }
        
        for (var i = __this.Count; i < n; i++)
        {
            delete __this[i];
            delete __this.Item[i];
        }
    }
    
    ___Properties();
    
    this.Enumerator = function()
    {
        // summary:
        //   Enumerates the elements of a ObjectCollection.
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
    
    this.Add = function(/*Object*/ obj)
    {
        // summary:
        //   Adds an item to the list of items for a ListBox.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Nothing
        
        if (typeof obj != "undefined")
        {
            this.Insert(this.Count, obj);
        }
    }
    
    this.AddRange = function(/*Array*/ collection)
    {
        // summary:
        //   Adds a group of items to the list of items
        //   for a ListBox.
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
                
                var o = [];
                
                if (collection.Enumerator != null)
                {
                    try
                    {
                        var o1 = collection.GetEnumerator();
                        
                        while (o1.MoveNext())
                        {
                            o.push(o1.Item[o1.Current].get());
                        }
                    }
                    catch (e)
                    {
                        b = true;
                    }
                }
                else
                {
                    o = collection;
                }
                
                if (!b)
                {
                    for (var i = 0; i < o.length; i++)
                    {
                        this.Add(o[i]);
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
        //   Removes all items from the collection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        __ordered = [];
        this.Item = {};
        
        ___Properties();
    }
    
    this.Contains = function(/*Object*/ index)
    {
        // summary:
        //   Determines whether the specified item is located
        //   within the collection.
        //
        // arguments:
        //   index (required)
        //
        // returns: Boolean
        
        if (typeof index != "undefined")
        {
            return (this.IndexOf(index) != -1);
        }
        
        return false;
    }
    
    this.CopyTo = function(/*Array*/ collection, /*Integer*/ index, /*Integer*/ count)
    {
        // summary:
        //   Copies the entire collection into an existing array
        //   of objects at a specified location within the array.
        //
        // arguments:
        //   collection (required)
        //   index (optional)
        //   count (optional)
        //
        // returns: Nothing
        
        if (collection != null && collection.splice != null)
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
                collection[i] = __ordered[i];
            }
            
            if (collection.length > i)
            {
                collection.splice(i, collection.length - i);
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
        
        if (obj0.Count == obj1.Count)
        {
            for (var i = 0; i < obj0.Count; i++)
            {
                if (obj0[i] != obj1[i] || typeof obj0[i] != typeof obj1[i])
                {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
    
    this.GetEnumerator = function()
    {
        // summary:
        //   Returns an enumerator to use to iterate through
        //   the item collection.
        //
        // arguments:
        //   none
        //
        // returns: Nothing
        
        return new this.Enumerator();
    }
    
    this.IndexOf = function(/*Integer*/ index)
    {
        // summary:
        //   Returns the index within the collection of the
        //   specified item.
        //
        // arguments:
        //   index (required)
        //
        // returns: Integer
        
        if (typeof index != "undefined")
        {
            for (var i = 0; i < this.Count; i++)
            {
                if (__ordered[i] == index)
                {
                    return i;
                }
            }
        }
        
        return -1;
    }
    
    this.Insert = function(/*Integer*/ index, /*Object*/ obj)
    {
        // summary:
        //   Inserts an item into the list box at the specified index.
        //
        // arguments:
        //   index (required)
        //   obj (required)
        //
        // returns: Nothing
        
        if (index != null && typeof obj != "undefined")
        {
            if (index >= 0)
            {
                index = Math.min(index, this.Count);
                __ordered.splice(index, 0, obj);
                
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
    
    this.Remove = function(/*Object*/ obj)
    {
        // summary:
        //   Removes the specified object from the collection.
        //
        // arguments:
        //   obj (required)
        //
        // returns: Nothing
        
        if (typeof obj != "undefined")
        {
            var n = this.IndexOf(obj);
            
            if (n != -1)
            {
                this.RemoveAt(n);
            }
        }
    }
    
    this.RemoveAt = function(/*Integer*/ index)
    {
        // summary:
        //   Removes the item at the specified index within
        //   the collection.
        //
        // arguments:
        //   index (required)
        //
        // returns: Nothing
        
        if (index != null)
        {
            if (index >= 0 && index < this.Count)
            {
                __ordered.splice(index, 1);
                
                ___Properties();
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
        
        return __ordered.toString();
    }
}

if (typeof ObjectCollection == "undefined")
{
    ObjectCollection = __System.Controls.UI.ListBox.ObjectCollection;
}

__System.Import("System.Controls.UI.ListBox.ObjectCollection", true);
